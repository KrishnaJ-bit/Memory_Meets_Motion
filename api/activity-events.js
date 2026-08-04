export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST');
    response.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  response.status(200).json({
    ok: true,
    mode: 'vercel-simulated-capture',
    detail: 'Presence event accepted by the public Oto.ai demo endpoint.',
  });
}
