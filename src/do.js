// Durable Object care persistă cererile abonaților + parola organizatorului.
// Creat automat de Cloudflare la deploy (vezi wrangler.toml → [[migrations]]),
// deci nu necesită nicio configurare manuală (namespace, id etc.).

import { DurableObject } from 'cloudflare:workers';
import * as store from './store.js';

export class Store extends DurableObject {
  createRequest(input) {
    return store.createRequest(this.ctx.storage, input);
  }
  getRequest(id) {
    return store.getRequest(this.ctx.storage, id);
  }
  updateRequest(id, patch) {
    return store.updateRequest(this.ctx.storage, id, patch);
  }
  listRequests(limit) {
    return store.listRequests(this.ctx.storage, limit);
  }
  getAuth() {
    return store.getAuth(this.ctx.storage);
  }
  setPassword(password) {
    return store.setPassword(this.ctx.storage, password);
  }
  verifyPassword(password) {
    return store.verifyPassword(this.ctx.storage, password);
  }
}

// Stub către singura instanță (toate cererile într-un singur DO).
export function storeStub(env) {
  return env.STORE.get(env.STORE.idFromName('main'));
}
