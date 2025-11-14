export default function Home() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
  const apiVersion = process.env.NEXT_PUBLIC_API_VERSION || 'v1';

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Travel App - Frontend</h1>
      <p>Frontend is running successfully!</p>
      <div style={{ marginTop: '2rem', padding: '1rem', background: '#f0f0f0', borderRadius: '8px' }}>
        <h2>API Configuration</h2>
        <p><strong>API URL:</strong> {apiUrl}</p>
        <p><strong>API Version:</strong> {apiVersion}</p>
      </div>
    </main>
  )
}

