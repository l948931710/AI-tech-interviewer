import 'dotenv/config';

async function testFetch() {
  const resStart = await fetch('http://localhost:3000/api/agent/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Provide dummy headers to bypass the auth check...
      // Actually, wait! The auth checks the database.
      // 
    },
    body: JSON.stringify({
      sessionId: "dummy",
      language: 'zh-CN'
    })
  });
  
  console.log(resStart.status);
  console.log(await resStart.text());
}
testFetch();
