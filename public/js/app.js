// app.js (module)
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.24.0/firebase-app.js";
import {
  getAuth, signInAnonymously, signInWithPopup, GoogleAuthProvider, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/9.24.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc, serverTimestamp, query, where, getDocs, enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/9.24.0/firebase-firestore.js";
import { friendlySlug } from "./utils.js";

const firebaseConfig = {
  // TODO: replace with your Firebase config
  apiKey: "AIzaSyArSAU4igEY7LKfx-G2kE8kEj9msssK9hs",
  authDomain: "cric-scorer-fc6ab.firebaseapp.com",
  projectId: "cric-scorer-fc6ab",
  storageBucket: "cric-scorer-fc6ab.firebasestorage.app",
  messagingSenderId: "763007551778",
  appId: "1:763007551778:web:c876262a3cff1fee813d7b"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
try { await enableIndexedDbPersistence(db); } catch(e){ console.warn('Offline persistence not enabled', e); }

const btnAnon = document.getElementById('btn-anon');
const btnGoogle = document.getElementById('btn-google');
const userInfo = document.getElementById('user-info');
const matchForm = document.getElementById('match-form');
const matchesList = document.getElementById('matches-list');

btnAnon.addEventListener('click', async () => {
  try { await signInAnonymously(auth); } catch(e){ alert(e.message); }
});
btnGoogle.addEventListener('click', async () => {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch(e){ alert(e.message); }
});

onAuthStateChanged(auth, user => {
  if(user){
    userInfo.hidden = false;
    userInfo.innerText = `Signed in as ${user.isAnonymous ? 'Anonymous' : (user.displayName || user.email)}`;
  } else userInfo.hidden = true;
});

matchForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(matchForm);
  const title = f.get('title').trim();
  const slug = friendlySlug(`${title}-${f.get('date')||''}`);
  const doc = {
    title,
    type: f.get('type'),
    team1: f.get('team1').trim(),
    team2: f.get('team2').trim(),
    overs: parseInt(f.get('overs')||0,10),
    date: f.get('date') || null,
    startTime: f.get('time') || null,
    privacy: f.get('privacy'),
    creatorUid: auth.currentUser ? auth.currentUser.uid : null,
    createdAt: serverTimestamp(),
    slug,
    status: 'scheduled' // scheduled / live / completed
  };
  // create match doc (slug uniqueness handled server-side via function or transaction)
  try {
    const matchesColl = collection(db, 'matches');
    const ref = await addDoc(matchesColl, doc);
    // redirect to match page by ID (or slug after Cloud Function creates mapping)
    window.location = `/match.html?match=${ref.id}`;
  } catch(err){
    console.error(err);
    alert('Could not create match: '+err.message);
  }
});

// Basic listing of public matches
async function loadMatches(){
  const q = query(collection(db,'matches'), where('privacy','==','public'));
  const snap = await getDocs(q);
  matchesList.innerHTML = '';
  snap.forEach(d => {
    const m = d.data();
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `<strong>${m.title}</strong><div class="muted">${m.team1} vs ${m.team2}</div>
      <a href="/match.html?match=${d.id}">Open</a>`;
    matchesList.appendChild(div);
  });
}
loadMatches();
