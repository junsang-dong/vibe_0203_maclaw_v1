import { createApp } from "./server/app.js";

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

app.listen(port, () => {
  console.log(`Pi 미니멀 에이전트 서버 실행 중: http://localhost:${port}`);
});
