// Worker principal — Organizare Zi de Zi
// Servește site-ul static (binding ASSETS) și tratează API-ul agenților AI.

import { handlePlan } from './plan.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // API: generarea planului zilnic de către agenți
    if (url.pathname === '/api/plan') {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });
      }
      return handlePlan(request, env);
    }

    // Orice altceva → fișiere statice din /public (index.html, styles.css, app.js)
    return env.ASSETS.fetch(request);
  },
};
