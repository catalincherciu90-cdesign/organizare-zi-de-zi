// Durable Object care persistă cererile abonaților + parola organizatorului.
// Creat automat de Cloudflare la deploy (vezi wrangler.toml → [[migrations]]),
// deci nu necesită nicio configurare manuală (namespace, id etc.).

import { DurableObject } from 'cloudflare:workers';
import * as store from './store.js';

export class Store extends DurableObject {
  // ————— Cereri abonat —————
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

  // ————— Autentificare organizator —————
  getAuth() {
    return store.getAuth(this.ctx.storage);
  }
  setPassword(password) {
    return store.setPassword(this.ctx.storage, password);
  }
  verifyPassword(password) {
    return store.verifyPassword(this.ctx.storage, password);
  }

  // ————— Conturi abonați —————
  createAccount(email, password) {
    return store.createAccount(this.ctx.storage, email, password);
  }
  getAccount(email) {
    return store.getAccount(this.ctx.storage, email);
  }
  getAccountById(accId) {
    return store.getAccountById(this.ctx.storage, accId);
  }
  verifyAccount(email, password) {
    return store.verifyAccount(this.ctx.storage, email, password);
  }

  // ————— Sesiuni —————
  createSession(accId) {
    return store.createSession(this.ctx.storage, accId);
  }
  getSession(token) {
    return store.getSession(this.ctx.storage, token);
  }
  deleteSession(token) {
    return store.deleteSession(this.ctx.storage, token);
  }

  // ————— Istoric abonat —————
  listByOwner(accId, limit) {
    return store.listByOwner(this.ctx.storage, accId, limit);
  }

  // ————— Șabloane —————
  createTemplate(accId, input) {
    return store.createTemplate(this.ctx.storage, accId, input);
  }
  listTemplates(accId) {
    return store.listTemplates(this.ctx.storage, accId);
  }
  getTemplate(accId, id) {
    return store.getTemplate(this.ctx.storage, accId, id);
  }
  deleteTemplate(accId, id) {
    return store.deleteTemplate(this.ctx.storage, accId, id);
  }
}

// Stub către singura instanță (toate cererile într-un singur DO).
export function storeStub(env) {
  return env.STORE.get(env.STORE.idFromName('main'));
}
