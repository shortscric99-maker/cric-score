const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

function makeSlug(s){ return s.toString().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,60); }

exports.generateSlugOnCreate = functions.firestore.document('matches/{matchId}').onCreate(async (snap, context) => {
  const data = snap.data();
  if(data.slug) return null;
  const base = makeSlug(`${data.title}-${data.date || ''}`);
  // ensure uniqueness by suffixing numeric if needed
  let slug = base; let i=0;
  while(true){
    const q = await db.collection('matches').where('slug','==',slug).limit(1).get();
    if(q.empty) break;
    i++; slug = `${base}-${i}`;
  }
  return snap.ref.update({ slug });
});

// post-match stats summariser (example)
exports.computeFinalStats = functions.firestore.document('matches/{matchId}').onUpdate(async (change, context) => {
  const before = change.before.data();
  const after = change.after.data();
  if(before.status !== 'completed' && after.status === 'completed'){
    // compute final stats from balls subcollection
    const ballsSnap = await change.after.ref.collection('balls').get();
    // compute simple totals and write to match doc
    let runs=0, wickets=0, legal=0;
    ballsSnap.forEach(b => {
      const d = b.data(); runs += (d.runs||0)+(d.extraRuns||0);
      if(d.isLegal) legal++;
      if(d.wicket) wickets++;
    });
    const overs = Math.floor(legal/6) + '.' + (legal%6);
    return change.after.ref.update({ summary: { runs, wickets, overs }});
  } else return null;
});
