export function classifyApiError(status: number, bodyText: string): string {
  if (status === 401 || status === 403) {
    return `권한 오류(${status}): API 키 또는 권한을 확인하세요.`;
  }
  if (status === 429) {
    return `쿼터/레이트리밋 오류(${status}): 사용량 한도를 확인하세요.`;
  }
  if (status === 404) {
    return `모델 미지원 또는 경로 오류(${status}): 모델 이름을 확인하세요.`;
  }
  if (status >= 500) {
    return `서버 오류(${status}): 잠시 후 다시 시도하세요.`;
  }
  return `요청 실패(${status}): ${bodyText}`;
}

export async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text || "응답 본문이 비어 있습니다.";
  } catch {
    return "응답 본문을 읽지 못했습니다.";
  }
}
