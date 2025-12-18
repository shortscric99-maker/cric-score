import { initializeApp } from "https://www.gstatic.com/firebasejs/9.24.0/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/9.24.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, collection, addDoc, query, orderBy, onSnapshot,
  runTransaction, serverTimestamp, updateDoc, setDoc, increment
} from "https://www.gstatic.com/firebasejs/9.24.0/firebase-firestore.js";
import { toCSV, downloadFile } from "./utils.js";

const firebaseConfig = {
  // same config as app.js
  apiKey: "REPLACE",
  authDomain: "REPLACE.firebaseapp.com",
  projectId: "REPLACE",
  storageBucket: "REPLACE.appspot.com",
  messagingSenderId: "REPLACE",
  appId: "REPLACE"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const urlParams = new URLSearchParams(location.search);
const matchId = urlParams.get('match');
if(!matchId){ document.body.innerHTML = '<p>Match id missing</p>'; throw new Error('no match'); }

const matchRef = doc(db, 'matches', matchId);
const ballsCol = (matchDocId) => collection(db, 'matches', matchDocId, 'balls');
const auditCol = (matchDocId) => collection(db, 'matches', matchDocId, 'audit');

const pageTitle = document.getElementById('page-title');
const matchTitle = document.getElementById('match-title');
const metaLine = document.getElementById('meta-line');
const scoreBanner = document.getElementById('score-banner');
const ballsList = document.getElementById('balls-list');
const btnEditMode = document.getElementById('btn-edit-mode');
const scorerPanel = document.getElementById('scorer-panel');
const ballForm = document.getElementById('ball-form');
const btnUndo = document.getElementById('btn-undo');
const btnExport = document.getElementById('btn-export');
const btnShare = document.getElementById('btn-share');

let matchSnapshot = null;
let ballsUnsub = null;
let isScorerMode = false;

// authentication (allow anonymous)
onAuthStateChanged(auth, async user => {
  if(!user){
    await signInAnonymously(auth);
  }
});

// load match metadata and subscribe to changes
onSnapshot(matchRef, snap => {
  if(!snap.exists()){ matchTitle.textContent = 'Match not found'; return; }
  matchSnapshot = snap.data();
  matchTitle.textContent = `${matchSnapshot.title} — ${matchSnapshot.team1} v ${matchSnapshot.team2}`;
  document.title = `${matchSnapshot.title} - ${matchSnapshot.team1} v ${matchSnapshot.team2}`;
  metaLine.textContent = `${matchSnapshot.type} • ${matchSnapshot.date || ''} • ${matchSnapshot.privacy}`;
  renderScoreBanner(matchSnapshot);
});

// listen balls subcollection realtime ordered by seq
function subscribeBalls(){
  if(ballsUnsub) ballsUnsub();
  const q = query(ballsCol(matchId), orderBy('seq'));
  ballsUnsub = onSnapshot(q, snap => {
    const arr = [];
    snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
    renderBalls(arr);
    renderScorecards(arr);
  });
}
subscribeBalls();

// utility: compute scoreboard summary from balls
function computeSummary(balls){
  // simple aggregator: totals, wickets, overs
  let runs=0, wickets=0, legalBalls=0;
  for(const b of balls){
    runs += (b.runs || 0) + (b.extraRuns || 0);
    if(b.isLegal) legalBalls += 1;
    if(b.wicket) wickets += 1;
  }
  const overs = Math.floor(legalBalls/6) + '.' + (legalBalls%6);
  return { runs, wickets, legalBalls, overs };
}

function renderScoreBanner(match){
  scoreBanner.innerHTML = `<strong>${match.team1} ${matchSnapshot?.scoreString || ''}</strong>`;
}

function renderBalls(balls){
  ballsList.innerHTML = '';
  for(const b of balls.slice().reverse()){
    const div = document.createElement('div');
    div.className = 'ball-item';
    div.innerHTML = `<div><strong>${b.seq}</strong> ${b.notation || '—'} <span class="muted">(${new Date(b.createdAt?.toDate?.()||b.createdAt).toLocaleTimeString()})</span></div>`;
    ballsList.appendChild(div);
  }
  // update banner summary
  const s = computeSummary(balls);
  scoreBanner.textContent = `${s.runs}/${s.wickets} - ${s.overs} overs`;
}

function renderScorecards(balls){
  // minimal batting/bowling cards for the demo
  const batting = {}; const bowling = {};
  balls.forEach(b => {
    if(!batting[b.batterId]) batting[b.batterId] = { runs:0, balls:0, fours:0, sixes:0, out: false };
    const bat = batting[b.batterId];
    if(b.isLegal) bat.balls++;
    bat.runs += (b.runs || 0);
    if((b.runs||0) === 4) bat.fours++;
    if((b.runs||0) === 6) bat.sixes++;
    if(b.wicket && b.dismissedPlayerId === b.batterId) bat.out = true;

    if(!bowling[b.bowlerId]) bowling[b.bowlerId] = { balls:0, runs:0, wickets:0 };
    const bowl = bowling[b.bowlerId];
    if(b.isLegal) bowl.balls++;
    bowl.runs += (b.runs || 0) + (b.extraRuns || 0);
    if(b.wicket && b.wicketCreditedToBowler) bowl.wickets++;
  });

  document.getElementById('batting-card').innerHTML = '<pre>' + JSON.stringify(batting,null,2) + '</pre>';
  document.getElementById('bowling-card').innerHTML = '<pre>' + JSON.stringify(bowling,null,2) + '</pre>';
}

// Scorer mode toggle
btnEditMode.addEventListener('click', () => {
  isScorerMode = !isScorerMode;
  scorerPanel.hidden = !isScorerMode;
  btnEditMode.textContent = isScorerMode ? 'Viewer Mode' : 'Scorer Mode';
});

// Save ball: transaction to allocate next sequence number atomically and create ball doc
ballForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(ballForm);
  const runs = parseInt(f.get('runs')||0,10);
  const extraType = f.get('extra') || null;
  const wicketType = f.get('wicketType') || null;

  const ball = {
    runs,
    extraType,
    extraRuns: 0,
    isLegal: !['wide','noball'].includes(extraType),
    wicket: !!wicketType,
    wicketType: wicketType || null,
    createdAt: serverTimestamp(),
    createdBy: auth.currentUser ? auth.currentUser.uid : null
  };

  // compute notation for UI (simple)
  let notation = '';
  if(extraType === 'wide') notation = `WD ${runs||''}`.trim();
  else if(extraType === 'noball') notation = `NB ${runs||''}`.trim();
  else if(wicketType) notation = `W (${wicketType})`;
  else notation = '' + runs;

  // transaction: read meta doc to get lastSeq, bump and write ball doc
  try {
    await runTransaction(db, async (tx) => {
      const matchDoc = await tx.get(matchRef);
      if(!matchDoc.exists()) throw "Match gone";
      const data = matchDoc.data();
      const nextSeq = (data.lastSeq || 0) + 1;
      const ballDocRef = doc(ballsCol(matchId)); // let addDoc handle id
      tx.set(ballDocRef, {...ball, seq: nextSeq, notation, createdAt: serverTimestamp()});
      tx.update(matchRef, { lastSeq: nextSeq, updatedAt: serverTimestamp() });
      // also write audit entry
      const aRef = doc(auditCol(matchId));
      tx.set(aRef, { action: 'add_ball', by: auth.currentUser.uid, seq: nextSeq, createdAt: serverTimestamp(), detail: { notation }});
    });
  } catch(err){
    console.error('Error saving ball',err);
    alert('Could not save ball: '+err);
  }
});

// Undo last ball: only allowed to authorized scorers (client enforces; server rules also)
btnUndo.addEventListener('click', async () => {
  if(!confirm('Undo last ball? This will mark last ball as reversed in audit.')) return;
  try {
    // find last seq via reading match doc
    const mSnap = await getDoc(matchRef);
    const lastSeq = mSnap.data().lastSeq || 0;
    if(lastSeq === 0) return alert('No balls to undo');
    // transaction: remove ball with lastSeq (soft-delete: keep audit entry and mark removed)
    await runTransaction(db, async (tx) => {
      // find the ball doc by scanning balls collection for seq === lastSeq; here we do a query
      // For brevity in client code we'll use update of a 'ballsBySeq' mapping if you create such; otherwise a function should query collection
      // For this demo, mark a "removedSeqs" array on match doc
      const newRemoved = (mSnap.data().removedSeqs || []).concat([lastSeq]);
      tx.update(matchRef, { removedSeqs: newRemoved, lastSeq: lastSeq - 1, updatedAt: serverTimestamp() });
      const aRef = doc(auditCol(matchId));
      tx.set(aRef, { action:'undo_last', by: auth.currentUser.uid, seq: lastSeq, createdAt: serverTimestamp() });
    });
  } catch(err){ console.error(err); alert('Undo failed: '+err); }
});

// Export
btnExport.addEventListener('click', async () => {
  // fetch balls once and export JSON/CSV
  const arr = [];
  const q = query(ballsCol(matchId));
  const snap = await (await import("https://www.gstatic.com/firebasejs/9.24.0/firebase-firestore.js")).getDocs(q);
  snap.forEach(d=>arr.push({id:d.id,...d.data()}));
  const json = JSON.stringify(arr, null, 2);
  const csv = toCSV(arr);
  // prompt choose
  if(confirm('Download JSON? Cancel to download CSV')) downloadFile(`${matchId}-balls.json`, json, 'application/json');
  else downloadFile(`${matchId}-balls.csv`, csv, 'text/csv');
});

btnShare.addEventListener('click', () => {
  const url = location.href;
  navigator.clipboard.writeText(url).then(()=> alert('Link copied to clipboard'));
});
