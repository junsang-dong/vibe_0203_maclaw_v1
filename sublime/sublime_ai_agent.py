import json
import threading
import http.client
import difflib
import html
import re
import sublime
import sublime_plugin


SERVER_HOST = "localhost"
SERVER_PORT = 3000
USER_LABEL = "junsangdong"
ASSISTANT_LABEL = "Maclaw"
USER_BG = "#f2f2f2"
ASSISTANT_BG = "#e6f2ff"


def _build_rpc_request(prompt, context, stream=True, request_id=1):
    return {
        "jsonrpc": "2.0",
        "method": "agent.process",
        "params": {
            "prompt": prompt,
            "context": context,
            "stream": stream
        },
        "id": request_id
    }


def _send_streaming_rpc(payload, on_start, on_delta, on_final, on_error):
    try:
        body = json.dumps(payload)
        conn = http.client.HTTPConnection(SERVER_HOST, SERVER_PORT, timeout=60)
        conn.request("POST", "/rpc", body=body, headers={"Content-Type": "application/json"})
        resp = conn.getresponse()
        if resp.status != 200:
            on_error("서버 응답 오류: {}".format(resp.status))
            return

        buffer = ""
        while True:
            line = resp.fp.readline()
            if not line:
                break
            try:
                data = json.loads(line.decode("utf-8"))
                result = data.get("result") or {}
                chunk_type = result.get("type")
                if chunk_type == "start":
                    on_start(result.get("sessionId"))
                elif chunk_type == "delta":
                    on_delta(result.get("content", ""))
                elif chunk_type == "tool":
                    name = result.get("name", "tool")
                    args = result.get("arguments", "")
                    on_delta("\n[툴 호출] {} {}\n".format(name, args))
                elif chunk_type == "final":
                    on_final(result.get("result"))
            except Exception:
                buffer += line.decode("utf-8")
        conn.close()
    except Exception as e:
        on_error(str(e))


def _show_output_panel(window, content):
    panel = window.create_output_panel("ai_agent")
    panel.run_command("append", {"characters": content})
    window.run_command("show_panel", {"panel": "output.ai_agent"})

def _append_session_message(session_id, role, content):
    try:
        payload = json.dumps({"role": role, "content": content})
        conn = http.client.HTTPConnection(SERVER_HOST, SERVER_PORT, timeout=30)
        conn.request(
            "POST",
            "/api/agent/sessions/{}/messages".format(session_id),
            body=payload,
            headers={"Content-Type": "application/json"}
        )
        conn.getresponse()
        conn.close()
    except Exception:
        return


def _request_terminal(command):
    try:
        payload = json.dumps({"command": command})
        conn = http.client.HTTPConnection(SERVER_HOST, SERVER_PORT, timeout=30)
        conn.request(
            "POST",
            "/api/agent/terminal/request",
            body=payload,
            headers={"Content-Type": "application/json"}
        )
        resp = conn.getresponse()
        body = resp.read().decode("utf-8")
        conn.close()
        if resp.status != 200:
            return None, "요청 실패: {}".format(resp.status)
        data = json.loads(body)
        return data, None
    except Exception as e:
        return None, str(e)


def _execute_terminal(request_id, approve):
    try:
        payload = json.dumps({"requestId": request_id, "approve": approve})
        conn = http.client.HTTPConnection(SERVER_HOST, SERVER_PORT, timeout=60)
        conn.request(
            "POST",
            "/api/agent/terminal/execute",
            body=payload,
            headers={"Content-Type": "application/json"}
        )
        resp = conn.getresponse()
        body = resp.read().decode("utf-8")
        conn.close()
        if resp.status != 200:
            return None, "실행 실패: {}".format(resp.status)
        data = json.loads(body)
        return data, None
    except Exception as e:
        return None, str(e)


def _show_confirm_popup(view, html_content, on_navigate):
    if view is None:
        return
    region = view.sel()[0] if view.sel() else sublime.Region(0, 0)
    view.add_phantom(
        "ai_agent_terminal_approval",
        region,
        html_content,
        sublime.LAYOUT_BLOCK,
        on_navigate=on_navigate
    )


def _hide_confirm_popup(view):
    if view is None:
        return
    view.erase_phantoms("ai_agent_terminal_approval")


def _extract_terminal_commands(text):
    commands = []
    for match in re.finditer(r"```(?:bash|sh|shell)\n(.*?)```", text, re.S):
        cmd = match.group(1).strip()
        if cmd:
            commands.append(cmd)
    for line in text.splitlines():
        if line.lower().startswith("terminal:"):
            cmd = line.split(":", 1)[1].strip()
            if cmd:
                commands.append(cmd)
    return commands


def _enqueue_terminal_commands(view, commands):
    if view is None:
        return
    queue = view.settings().get("ai_agent_terminal_queue") or []
    seen = set(view.settings().get("ai_agent_terminal_seen") or [])
    for cmd in commands:
        if cmd not in seen:
            seen.add(cmd)
            queue.append(cmd)
    view.settings().set("ai_agent_terminal_queue", queue)
    view.settings().set("ai_agent_terminal_seen", list(seen))


def _process_terminal_queue(view):
    if view is None:
        return
    if view.settings().get("ai_agent_terminal_active"):
        return
    queue = view.settings().get("ai_agent_terminal_queue") or []
    if not queue:
        return
    policy = view.settings().get("ai_agent_terminal_policy") or "ask"
    command = queue[0]

    if policy == "deny":
        queue.pop(0)
        view.settings().set("ai_agent_terminal_queue", queue)
        _process_terminal_queue(view)
        return

    def run_command(approve, always_policy=None):
        if always_policy:
            view.settings().set("ai_agent_terminal_policy", always_policy)
        view.settings().set("ai_agent_terminal_active", True)

        def worker():
            request, error = _request_terminal(command)
            if error:
                sublime.set_timeout(
                    lambda: _show_output_panel(view.window(), "\n[오류] " + error + "\n"), 0
                )
                finish()
                return
            request_id = request.get("id")
            if not request_id:
                sublime.set_timeout(
                    lambda: _show_output_panel(view.window(), "\n[오류] 요청 ID 없음\n"), 0
                )
                finish()
                return

            result, exec_error = _execute_terminal(request_id, approve)
            if exec_error:
                _show_output_panel(view.window(), "\n[오류] " + exec_error + "\n")
            else:
                if not result.get("ok"):
                    _show_output_panel(view.window(), "\n[정보] 실행이 거부되었습니다.\n")
                else:
                    res = result.get("result", {})
                    output = (
                        "\n[터미널 결과]\n"
                        "command: {}\n"
                        "exitCode: {}\n"
                        "stdout:\n{}\n"
                        "stderr:\n{}\n"
                    ).format(command, res.get("exitCode"), res.get("stdout"), res.get("stderr"))
                    _show_output_panel(view.window(), output)
                    session_id = view.settings().get("ai_agent_last_session_id")
                    if session_id:
                        _append_session_message(session_id, "tool", output)
            finish()

        def finish():
            queue.pop(0)
            view.settings().set("ai_agent_terminal_queue", queue)
            view.settings().set("ai_agent_terminal_active", False)
            _process_terminal_queue(view)

        threading.Thread(target=worker, daemon=True).start()

    if policy == "allow":
        run_command(True)
        return

    safe_command = html.escape(command)
    popup_html = (
        "<div style='font-family:-apple-system; font-size:12px;'>"
        "<div style='display:flex; justify-content:space-between; align-items:center;'>"
        "<h3 style='margin:0;'>터미널 실행 승인</h3>"
        "<a href='close' style='text-decoration:none;'>✕</a>"
        "</div>"
        "<div style='margin:8px 0;'>아래 명령을 실행할까요?</div>"
        "<pre style='background:#f6f6f6; padding:8px; border-radius:6px;'>"
        "{}"
        "</pre>"
        "<a href='approve'>승인</a> · <a href='reject'>거부</a>"
        "<br>"
        "<a href='always_allow'>항상 허용</a> · <a href='always_deny'>항상 거부</a>"
        "</div>"
    ).format(safe_command)

    def on_navigate(href):
        if href == "close":
            _hide_confirm_popup(view)
            return
        if href == "approve":
            _hide_confirm_popup(view)
            run_command(True)
            return
        if href == "reject":
            _hide_confirm_popup(view)
            run_command(False)
            return
        if href == "always_allow":
            _hide_confirm_popup(view)
            run_command(True, "allow")
            return
        if href == "always_deny":
            _hide_confirm_popup(view)
            run_command(False, "deny")
            return

    _show_confirm_popup(view, popup_html, on_navigate)


def _maybe_trigger_terminal(view, chunk):
    if view is None:
        return
    buffer = view.settings().get("ai_agent_response_buffer") or ""
    buffer += chunk
    view.settings().set("ai_agent_response_buffer", buffer)
    commands = _extract_terminal_commands(buffer)
    if commands:
        _enqueue_terminal_commands(view, commands)
        _process_terminal_queue(view)



def _show_history_popup(view, html_content, on_navigate=None):
    def _default_navigate(href):
        if href == "close":
            view.hide_popup()

    view.show_popup(
        html_content,
        max_width=900,
        max_height=600,
        flags=0,
        on_navigate=on_navigate or _default_navigate
    )


def _show_chat_popup(view, html_content, on_navigate=None):
    return


def _append_chat_popup(view, chunk):
    return


def _fetch_session_messages(session_id):
    try:
        conn = http.client.HTTPConnection(SERVER_HOST, SERVER_PORT, timeout=30)
        conn.request("GET", "/api/agent/sessions/{}".format(session_id))
        resp = conn.getresponse()
        if resp.status != 200:
            return None, "세션 조회 실패: {}".format(resp.status)
        body = resp.read().decode("utf-8")
        conn.close()
        data = json.loads(body)
        return data.get("messages", []), None
    except Exception as e:
        return None, str(e)

def _format_role(role):
    if role == "user":
        return USER_LABEL
    if role == "assistant":
        return ASSISTANT_LABEL
    return role


def _role_bg(role):
    if role == "user":
        return USER_BG
    if role == "assistant":
        return ASSISTANT_BG
    return "#ffffff"


def _message_html(role, created_at, content):
    safe_content = html.escape(content).replace("\n", "<br>")
    safe_role = html.escape(_format_role(role))
    safe_time = html.escape(created_at)
    bg = _role_bg(role)
    return (
        "<div style='background-color:{}; padding:6px; margin:6px 0; "
        "border-radius:6px; font-family: -apple-system; font-size:12px;'>"
        "<div><strong>[{}]</strong> {} </div>"
        "<div>{}</div>"
        "</div>"
    ).format(bg, safe_role, safe_time, safe_content)


def _fetch_sessions():
    try:
        conn = http.client.HTTPConnection(SERVER_HOST, SERVER_PORT, timeout=30)
        conn.request("GET", "/api/agent/sessions")
        resp = conn.getresponse()
        if resp.status != 200:
            return None, "세션 목록 조회 실패: {}".format(resp.status)
        body = resp.read().decode("utf-8")
        conn.close()
        data = json.loads(body)
        return data, None
    except Exception as e:
        return None, str(e)


def _build_diff_html(original_text, new_text):
    diff = difflib.unified_diff(
        original_text.splitlines(),
        new_text.splitlines(),
        lineterm=""
    )
    diff_text = "\n".join(diff)
    escaped = html.escape(diff_text)
    return "<pre>{}</pre><a href='accept'>수락</a> · <a href='reject'>거부</a>".format(escaped)


def _store_pending_changes(view, changes):
    view.settings().set("ai_agent_pending_changes", changes)


def _apply_pending_changes(view, edit):
    changes = view.settings().get("ai_agent_pending_changes") or []
    for change in changes:
        start, end = change.get("range", [0, 0])
        region = sublime.Region(start, end)
        view.replace(edit, region, change.get("newText", ""))
    view.settings().erase("ai_agent_pending_changes")


class AiAgentChatCommand(sublime_plugin.WindowCommand):
    def run(self):
        self.window.show_input_panel("에이전트에게 요청", "", self.on_done, None, None)

    def on_done(self, text):
        view = self.window.active_view()
        if view is None:
            return
        if not text:
            return

        file_path = view.file_name()
        full_text = view.substr(sublime.Region(0, view.size()))
        context = {
            "file": file_path,
            "selection": full_text,
            "range": [0, view.size()]
        }

        payload = _build_rpc_request(text, context, stream=True, request_id=1)

        prompt_header = "\n[에이전트에게 요청]\n{}\n\n[응답]\n".format(text)
        sublime.set_timeout(lambda: _show_output_panel(self.window, prompt_header), 0)

        def on_start(session_id):
            if session_id:
                view.settings().set("ai_agent_last_session_id", session_id)
            view.settings().set("ai_agent_terminal_active", False)
            view.settings().set("ai_agent_terminal_queue", [])
            view.settings().set("ai_agent_terminal_seen", [])
            view.settings().erase("ai_agent_response_buffer")

        def on_delta(chunk):
            sublime.set_timeout(lambda: _show_output_panel(self.window, chunk), 0)
            sublime.set_timeout(lambda: _maybe_trigger_terminal(view, chunk), 0)

        def on_final(result):
            if result and result.get("type") == "message":
                final_text = "\n\n[완료]\n" + result.get("content", "")
                sublime.set_timeout(lambda: _show_output_panel(self.window, final_text), 0)
                sublime.set_timeout(lambda: _maybe_trigger_terminal(view, final_text), 0)

        def on_error(message):
            sublime.set_timeout(lambda: _show_output_panel(self.window, "\n[오류] " + message), 0)

        threading.Thread(
            target=_send_streaming_rpc,
            args=(payload, on_start, on_delta, on_final, on_error),
            daemon=True
        ).start()


class AiAgentEditCommand(sublime_plugin.TextCommand):
    def run(self, edit):
        selection = self.view.sel()[0]
        selected_text = self.view.substr(selection)
        file_path = self.view.file_name()

        context = {
            "file": file_path,
            "selection": selected_text,
            "range": [selection.begin(), selection.end()]
        }

        payload = _build_rpc_request("선택 영역을 개선해줘", context, stream=True, request_id=2)
        window = self.view.window()

        def on_start(session_id):
            if session_id:
                self.view.settings().set("ai_agent_last_session_id", session_id)
            self.view.settings().set("ai_agent_terminal_active", False)
            self.view.settings().set("ai_agent_terminal_queue", [])
            self.view.settings().set("ai_agent_terminal_seen", [])
            self.view.settings().erase("ai_agent_response_buffer")

        def on_delta(chunk):
            if window:
                sublime.set_timeout(lambda: _show_output_panel(window, chunk), 0)
            sublime.set_timeout(lambda: _maybe_trigger_terminal(self.view, chunk), 0)

        def on_final(result):
            if not result:
                return
            if result.get("type") == "edit":
                changes = result.get("changes", [])
                _store_pending_changes(self.view, changes)
                original = selected_text
                new_text = changes[0].get("newText", "") if changes else ""
                diff_html = _build_diff_html(original, new_text)
                self.view.show_popup(
                    diff_html,
                    max_width=800,
                    on_navigate=self._handle_diff_action
                )
            elif result.get("type") == "message" and window:
                final_text = "\n\n[완료]\n" + result.get("content", "")
                sublime.set_timeout(lambda: _show_output_panel(window, final_text), 0)
                sublime.set_timeout(lambda: _maybe_trigger_terminal(self.view, final_text), 0)

        def on_error(message):
            if window:
                sublime.set_timeout(lambda: _show_output_panel(window, "\n[오류] " + message), 0)

        threading.Thread(
            target=_send_streaming_rpc,
            args=(payload, on_start, on_delta, on_final, on_error),
            daemon=True
        ).start()

    def _handle_diff_action(self, href):
        if href == "accept":
            self.view.run_command("ai_agent_apply_pending")
            self.view.hide_popup()
        elif href == "reject":
            self.view.settings().erase("ai_agent_pending_changes")
            self.view.hide_popup()


class AiAgentApplyPendingCommand(sublime_plugin.TextCommand):
    def run(self, edit):
        _apply_pending_changes(self.view, edit)


class AiAgentReviewCommand(sublime_plugin.TextCommand):
    def run(self, edit):
        full_text = self.view.substr(sublime.Region(0, self.view.size()))
        file_path = self.view.file_name()
        context = {
            "file": file_path,
            "selection": full_text,
            "range": [0, self.view.size()]
        }
        payload = _build_rpc_request("전체 파일 리뷰해줘", context, stream=True, request_id=3)
        window = self.view.window()

        def on_start(session_id):
            if session_id:
                self.view.settings().set("ai_agent_last_session_id", session_id)
            self.view.settings().set("ai_agent_terminal_active", False)
            self.view.settings().set("ai_agent_terminal_queue", [])
            self.view.settings().set("ai_agent_terminal_seen", [])
            self.view.settings().erase("ai_agent_response_buffer")

        def on_delta(chunk):
            if window:
                sublime.set_timeout(lambda: _show_output_panel(window, chunk), 0)
            sublime.set_timeout(lambda: _maybe_trigger_terminal(self.view, chunk), 0)

        def on_final(result):
            if result and result.get("type") == "message" and window:
                final_text = "\n\n[완료]\n" + result.get("content", "")
                sublime.set_timeout(lambda: _show_output_panel(window, final_text), 0)
                sublime.set_timeout(lambda: _maybe_trigger_terminal(self.view, final_text), 0)

        def on_error(message):
            if window:
                sublime.set_timeout(lambda: _show_output_panel(window, "\n[오류] " + message), 0)

        threading.Thread(
            target=_send_streaming_rpc,
            args=(payload, on_start, on_delta, on_final, on_error),
            daemon=True
        ).start()


class AiAgentShowHistoryCommand(sublime_plugin.WindowCommand):
    def run(self):
        view = self.window.active_view()
        if view is None:
            return
        session_id = view.settings().get("ai_agent_last_session_id")
        if not session_id:
            _show_output_panel(self.window, "[오류] 세션 ID를 찾을 수 없습니다.\n")
            return

        def worker():
            messages, error = _fetch_session_messages(session_id)
            if error:
                sublime.set_timeout(
                    lambda: _show_output_panel(self.window, "\n[오류] " + error + "\n"), 0
                )
                return
            lines = ["\n[대화 기록] session: {}\n".format(session_id)]
            for message in messages:
                role = message.get("role", "unknown")
                content = message.get("content", "")
                created_at = message.get("createdAt", "")
                lines.append("[{}] {} {}\n".format(_format_role(role), created_at, content))
            output = "".join(lines)
            sublime.set_timeout(lambda: _show_output_panel(self.window, output), 0)

        threading.Thread(target=worker, daemon=True).start()


class AiAgentShowAllHistoryCommand(sublime_plugin.WindowCommand):
    def run(self):
        def worker():
            sessions, error = _fetch_sessions()
            if error:
                sublime.set_timeout(
                    lambda: _show_output_panel(self.window, "\n[오류] " + error + "\n"), 0
                )
                return
            if not sessions:
                sublime.set_timeout(
                    lambda: _show_output_panel(self.window, "\n[정보] 세션이 없습니다.\n"), 0
                )
                return

            lines = ["\n[전체 대화 목록]\n"]
            html_blocks = [
                "<div style='font-family:-apple-system; font-size:12px;'>",
                "<div style='display:flex; justify-content:space-between; align-items:center;'>",
                "<h3 style='margin:0;'>전체 대화 목록</h3>",
                "<a href='close' style='text-decoration:none;'>✕</a>",
                "</div>"
            ]
            for idx, session in enumerate(sessions):
                session_id = session.get("id", "")
                updated_at = session.get("updatedAt", "")
                lines.append("\n- session: {} (updated: {})\n".format(session_id, updated_at))
                html_blocks.append(
                    "<div style='margin-top:12px; font-weight:600;'>"
                    "session: {} (updated: {})</div>".format(
                        html.escape(session_id), html.escape(updated_at)
                    )
                )
                messages = session.get("messages", [])
                for message in messages:
                    role = message.get("role", "unknown")
                    content = message.get("content", "")
                    created_at = message.get("createdAt", "")
                    lines.append("[{}] {} {}\n".format(_format_role(role), created_at, content))
                    html_blocks.append(_message_html(role, created_at, content))
                if idx != len(sessions) - 1:
                    lines.append("\n---\n")
                    html_blocks.append("<hr>")
            html_blocks.append("</div>")
            html_content = "".join(html_blocks)
            output = "".join(lines)
            sublime.set_timeout(lambda: _show_output_panel(self.window, output), 0)

        threading.Thread(target=worker, daemon=True).start()


class AiAgentShowAllHistoryPopupCommand(sublime_plugin.WindowCommand):
    def run(self):
        def worker():
            sessions, error = _fetch_sessions()
            if error:
                sublime.set_timeout(
                    lambda: _show_output_panel(self.window, "\n[오류] " + error + "\n"), 0
                )
                return
            if not sessions:
                sublime.set_timeout(
                    lambda: _show_output_panel(self.window, "\n[정보] 세션이 없습니다.\n"), 0
                )
                return

            html_blocks = [
                "<div style='font-family:-apple-system; font-size:12px;'>",
                "<h3>전체 대화 목록</h3>"
            ]
            for idx, session in enumerate(sessions):
                session_id = session.get("id", "")
                updated_at = session.get("updatedAt", "")
                html_blocks.append(
                    "<div style='margin-top:12px; font-weight:600;'>"
                    "session: {} (updated: {})</div>".format(
                        html.escape(session_id), html.escape(updated_at)
                    )
                )
                messages = session.get("messages", [])
                for message in messages:
                    role = message.get("role", "unknown")
                    content = message.get("content", "")
                    created_at = message.get("createdAt", "")
                    html_blocks.append(_message_html(role, created_at, content))
                if idx != len(sessions) - 1:
                    html_blocks.append("<hr>")
            html_blocks.append("</div>")
            html_content = "".join(html_blocks)
            sublime.set_timeout(
                lambda: _show_history_popup(self.window.active_view(), html_content), 0
            )

        threading.Thread(target=worker, daemon=True).start()
