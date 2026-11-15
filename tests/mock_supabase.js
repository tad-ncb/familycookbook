/* In-memory stand-in for supabase-js, served in place of the real library by
   tests/server.py. Implements just the surface src/app.js uses. The "database"
   lives in localStorage (key __mockdb) so it survives a page reload the way the
   real one does.

   Test controls, all on window.__sb:
     tables()                 -> the whole fake DB  {table: [rows]}
     seed(table, rows)        -> replace a table
     calls                    -> [{table, op, payload}] every request made
     failWith = fn(table, op) -> return {status, error:{message, code}} to fail a
                                 request, or null to let it through
     delayMs                  -> artificial latency per request (default 5)
     staleGuard               -> behave like migrations/014 (default true); skipped counts skipped writes
*/
(function(){
  const KEY = '__mockdb';
  const PK = { cook_log:['id'], plan_days:['slot_id'], inventory_items:['id'], shopping_lists:['id'],
               prefs:['household_id'], interested_recipes:['recipe_id','household_id'],
               family_submissions:['id'], client_errors:['id'], keepalive:['id'] };
  /* starts like production: the one seed cook-log entry is a real row there (migration 010) */
  const FRESH = ()=> ({cook_log: [{id: 'seed-ctm-1', recipe_id: 'chicken-tikka-masala', date: '2026-08-23', rating: 5, note: '', leftover: '',
                                  household_id: 'nicholas-tyler', deleted: false, updated_at: new Date(1788264000000).toISOString()}]});
  const load = ()=>{ try{ return JSON.parse(localStorage.getItem(KEY)) || FRESH(); }catch(e){ return FRESH(); } };
  const save = db=> localStorage.setItem(KEY, JSON.stringify(db));
  const ctl = window.__sb = {
    calls: [], failWith: null, delayMs: 5, staleGuard: true, skipped: 0,
    tables: load,
    seed(table, rows){ const db = load(); db[table] = rows; save(db); },
  };
  let autoId = 0;

  function exec(q){
    ctl.calls.push({table: q.table, op: q.op, payload: q.payload});
    const fail = ctl.failWith && ctl.failWith(q.table, q.op, q.payload);
    if(fail) return {data: null, error: fail.error || {message: 'injected', code: ''}, status: fail.status || 0};
    const db = load();
    const rows = db[q.table] || (db[q.table] = []);
    const match = r=> q.filters.every(f=> f(r));
    if(q.op === 'select'){
      let out = rows.filter(match);
      if(q.single) return {data: out[0] || null, error: null, status: 200};
      return {data: JSON.parse(JSON.stringify(out)), error: null, status: 200};
    }
    if(q.op === 'insert' || q.op === 'upsert'){
      const pk = PK[q.table] || ['id'];
      (Array.isArray(q.payload) ? q.payload : [q.payload]).forEach(row=>{
        row = Object.assign({}, row);
        if(pk.length === 1 && row[pk[0]] == null) row[pk[0]] = 'mock-' + (++autoId) + '-' + Date.now();
        if(q.table === 'family_submissions'){ if(!row.status) row.status = 'draft'; if(!row.created_at) row.created_at = new Date().toISOString(); }
        const at = rows.findIndex(r=> pk.every(k=> r[k] === row[k]));
        if(at === -1) rows.push(row);
        /* migrations/014: an update whose updated_at is OLDER than the stored row's is silently skipped */
        else if(q.op === 'upsert' && ctl.staleGuard && row.updated_at && rows[at].updated_at && Date.parse(row.updated_at) < Date.parse(rows[at].updated_at)) ctl.skipped = (ctl.skipped || 0) + 1;
        else if(q.op === 'upsert') rows[at] = Object.assign({}, rows[at], row);
        else return;
      });
      save(db);
      return {data: null, error: null, status: 201};
    }
    if(q.op === 'update'){ rows.filter(match).forEach(r=> Object.assign(r, q.payload)); save(db); return {data: null, error: null, status: 204}; }
    if(q.op === 'delete'){ db[q.table] = rows.filter(r=> !match(r)); save(db); return {data: null, error: null, status: 204}; }
    return {data: null, error: {message: 'mock: unknown op ' + q.op, code: ''}, status: 400};
  }

  function builder(table){
    const q = {table, op: 'select', payload: null, filters: [], single: false};
    const b = {
      select(){ if(q.op !== 'insert' && q.op !== 'upsert') q.op = q.op === 'select' ? 'select' : q.op; return b; },
      insert(p){ q.op = 'insert'; q.payload = p; return b; },
      upsert(p){ q.op = 'upsert'; q.payload = p; return b; },
      update(p){ q.op = 'update'; q.payload = p; return b; },
      delete(){ q.op = 'delete'; return b; },
      eq(col, v){ q.filters.push(r=> r[col] === v); return b; },
      in(col, vs){ q.filters.push(r=> vs.includes(r[col])); return b; },
      order(){ return b; }, limit(){ return b; }, range(){ return b; },
      maybeSingle(){ q.single = true; return b; },
      single(){ q.single = true; return b; },
      then(res, rej){
        return new Promise(r=> setTimeout(r, ctl.delayMs)).then(()=> exec(q)).then(res, rej);
      },
    };
    return b;
  }
  const channel = { on(){ return channel; }, subscribe(){ return channel; } };
  window.supabase = { createClient(){ return { from: builder, channel(){ return channel; }, removeChannel(){} }; } };
})();
