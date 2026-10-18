/* « Les cartes de Tartine » – the iPad web app of LaConfiture2 (2026-10-18). How it works: Docs/WebApp.md.
   The words come from daten.js (bauen.py writes it from SourceData/). Progress stays on the device (localStorage). */
'use strict';
(() => {
  const D = window.DATEN;
  const app = document.getElementById('app');
  if (!D) { app.textContent = 'Die Daten fehlen (daten.js).'; return; }
  const MOTS = D.mots;
  const QUIZ_MAX = 8;          // questions per quiz round
  const CARTES_MAX = 15;       // cards per round for « Tous les mots » and the difficult words

  // ---------- small helpers
  function el(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  }
  function melanger(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const attendre = ms => new Promise(r => setTimeout(r, ms));
  // « concentré/concentrée » may break after the slash – otherwise a long word makes the card wider than a phone
  const coupe = s => String(s).split('/').flatMap((t, k, a) => k < a.length - 1 ? [t + '/', el('wbr')] : [t]);
  const hasard = a => a[Math.floor(Math.random() * a.length)];

  // ---------- progress: a box per word (0 = not seen, 1 = again, 2 = almost, 3 = sure) and the best stars per deck
  const CLE = 'cartes-de-tartine-1';
  const VIDE = () => ({ boites: {}, etoiles: {}, sens: 'fr', astuce: false });
  let etat = VIDE();
  try {
    const s = JSON.parse(localStorage.getItem(CLE) || 'null');
    if (s && typeof s === 'object') etat = Object.assign(VIDE(), s);
  } catch (e) { /* private mode – the app works without saving */ }
  function sauver() { try { localStorage.setItem(CLE, JSON.stringify(etat)); } catch (e) { /* see above */ } }
  const boite = id => etat.boites[id] || 0;
  function monter(id) { etat.boites[id] = Math.min(3, Math.max(1, boite(id)) + 1); sauver(); }
  function descendre(id) { etat.boites[id] = 1; sauver(); }
  const gekonnt = ids => ids.filter(id => boite(id) >= 2).length;
  const RANG = { 1: 0, 0: 1, 2: 2, 3: 3 };                 // the order of a round: « again » first, then new words …
  const ordre = ids => melanger(ids).sort((a, b) => RANG[boite(a)] - RANG[boite(b)]);

  // ---------- sound: one line at a time, like in the game (Web Audio – iPadOS allows it after the first tap)
  // iPhone (2026-10-18, the user: no sound at all): Safari's Web Audio is of the type « ambient » – silent while the phone is on
  // silent mode. « playback » (iOS 17+) makes it sound like a video does.
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* older iOS: switch silent mode off */ }
  const Son = (() => {
    let ctx = null, source = null, jeton = 0;
    const tampons = new Map();
    function contexte() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        const s = ctx.createBufferSource();                 // a silent sample unlocks the sound on older iPads
        s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0);
      }
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      return ctx;
    }
    function charger(url) {
      let p = tampons.get(url);
      if (!p) {
        p = fetch(url).then(r => { if (!r.ok) throw new Error(url); return r.arrayBuffer(); })
          .then(b => new Promise((ok, nok) => ctx.decodeAudioData(b, ok, nok)));
        tampons.set(url, p);
        p.catch(() => tampons.delete(url));
      }
      return p;
    }
    function stop() {
      jeton++;
      if (source) { try { source.stop(); } catch (e) { /* already ended */ } source = null; }
    }
    // Plays the files one after the other (a number = a pause in ms). A new call stops the old one.
    async function dire(...suite) {
      stop();
      const moi = jeton, c = contexte();
      if (!c) return;
      for (const x of suite) {
        if (moi !== jeton) return;
        if (!x) continue;
        if (typeof x === 'number') { await attendre(x); continue; }
        let buf;
        try { buf = await charger(x); } catch (e) { continue; }
        if (moi !== jeton) return;
        await new Promise(fini => {
          const s = c.createBufferSource();
          s.buffer = buf; s.connect(c.destination);
          s.onended = fini; source = s; s.start(0);
          setTimeout(fini, buf.duration * 1000 + 400);    // in case the iPad holds the sound back
        });
      }
    }
    return { dire, stop, debloquer: contexte };
  })();
  ['touchend', 'click'].forEach(t => document.addEventListener(t, () => Son.debloquer(), { passive: true }));
  document.addEventListener('touchstart', () => {}, { passive: true });      // iOS shows the pressed look (:active) only with this

  const aMot = m => m.aw ? 'audio/w/' + m.aw : null;
  const aSatz = m => m.as ? 'audio/w/' + m.as : null;
  const aT = l => l && l.a ? 'audio/t/' + l.a : null;
  const derniere = {};
  function ligne(groupe) {                                  // a random line of Tartine's, never the same twice in a row
    const l = D.tartine[groupe] || [];
    if (!l.length) return null;
    const x = hasard(l.length > 1 ? l.filter(y => y.n !== derniere[groupe]) : l);
    derniere[groupe] = x.n;
    return x;
  }

  // ---------- wrong answers: same unit and Lernziel, never a word whose German meaning overlaps (like BP_QuizPlatz)
  const sens = de => de.toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  const chevauche = (a, b) => { const sa = sens(a.de); return sens(b.de).some(x => sa.includes(x)); };
  function leurres(m, k) {
    const choisis = [];
    const libre = o => o.id !== m.id && o.fr !== m.fr && o.de !== m.de && !chevauche(o, m)
      && !choisis.some(c => c.fr === o.fr || c.de === o.de || chevauche(c, o));
    const tous = Object.values(MOTS);
    for (const g of [tous.filter(o => o.u === m.u && o.lz === m.lz), tous.filter(o => o.u === m.u), tous]) {
      for (const o of melanger(g)) { if (choisis.length >= k) break; if (libre(o)) choisis.push(o); }
      if (choisis.length >= k) break;
    }
    return choisis;
  }

  // ---------- decks
  const paquetTous = u => ({ id: u.id + '-tous', titre: 'Tous les mots', de: 'Alle Wörter der ' + u.titre,
    ids: u.paquets.flatMap(p => p.ids), max: CARTES_MAX });
  const paquetDifficiles = () => ({ id: 'difficiles', titre: 'Mes mots difficiles', de: 'Meine schwierigen Wörter',
    ids: Object.keys(etat.boites).filter(id => etat.boites[id] === 1 && MOTS[id]), max: CARTES_MAX, sansEtoiles: true });

  // ---------- pieces of the screens
  let ecran = 0;                                            // changes with every screen, so old timers stop
  function nouvelEcran(...enfants) {
    ecran++;
    Son.stop();
    document.querySelectorAll('.voile').forEach(v => v.remove());
    app.replaceChildren(...enfants);
    window.scrollTo(0, 0);
    return ecran;
  }
  function entete(titre, sous, retour, droite) {
    const fleche = el('button', { class: 'retour', 'aria-label': 'Zurück', onclick: () => retour() });
    fleche.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return el('header', { class: 'entete' },
      fleche,
      el('div', { class: 'entete-titre' }, el('h1', null, titre), sous ? el('p', null, sous) : null),
      droite || el('span'));
  }
  function bulle(l, variante) {
    if (!l) return el('div');
    return el('div', { class: 'bulle' + (variante ? ' bulle-' + variante : '') },
      variante === 'accueil' ? null : el('img', { class: 'bulle-tete', src: 'img/tartine-tete.webp', alt: '' }),
      el('div', null, el('p', { class: 'bulle-fr' }, l.fr), l.de ? el('p', { class: 'bulle-de' }, l.de) : null));
  }
  const etoiles = (n, grand) => el('span', { class: 'etoiles' + (grand ? ' grand' : ''), 'aria-label': n + ' von 3 Sternen' },
    [0, 1, 2].map(k => el('span', { class: k < n ? 'on' : 'off' }, '★')));
  const barre = (ok, n) => el('div', { class: 'barre', role: 'progressbar', 'aria-valuenow': ok, 'aria-valuemax': n },
    el('span', { style: 'width:' + (n ? Math.round(100 * ok / n) : 0) + '%' }));
  const ICONE_SON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9.5v5h4l5 4.5v-14L7 9.5H3z" fill="currentColor"/>'
    + '<path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  function boutonSon(label, jouer) {
    const b = el('button', { class: 'son', 'aria-label': label, onclick: e => { e.stopPropagation(); jouer(); } });
    b.innerHTML = ICONE_SON;
    return b;
  }
  const bouton = (classe, fr, de, action) => el('button', { class: 'btn ' + classe, onclick: action }, fr, de ? el('small', null, de) : null);
  const image = m => m.img ? el('img', { class: 'mot-img', src: 'img/mots/' + m.img, alt: '' }) : null;

  // ---------- home
  function ecranAccueil() {
    const salut = D.lignes.accueil;
    const unites = D.unites.map(u => {
      const ids = u.paquets.flatMap(p => p.ids);
      return el('button', { class: 'tuile-unite', onclick: () => ecranUnite(u) },
        el('span', { class: 'u-titre' }, u.titre),
        el('span', { class: 'u-nom' }, '« ' + u.nom + ' »'),
        el('span', { class: 'u-de' }, u.de + ' · ' + ids.length + ' Wörter'),
        barre(gekonnt(ids), ids.length));
    });
    const diff = paquetDifficiles();
    nouvelEcran(el('div', { class: 'accueil' },
      el('img', { class: 'titre-img', src: 'img/titre.webp', width: 960, height: 586, alt: 'La Confiture' }),
      el('h1', { class: 'titre-app' }, 'Les cartes de Tartine'),
      el('div', { class: 'scene' },
        el('button', { class: 'tartine', 'aria-label': 'Tartine sprechen lassen', onclick: () => Son.dire(aT(salut)) },
          el('img', { src: 'img/tartine.webp', width: 398, height: 560, alt: '' })),
        bulle(salut, 'accueil')),
      el('div', { class: 'unites' }, unites),
      diff.ids.length ? el('div', { class: 'difficiles' }, tuilePaquet(diff, ecranAccueil)) : null,
      astuce(),
      el('button', { class: 'lien', onclick: reglages }, 'Einstellungen')));
  }

  function astuce() {                                        // how to put the app on the home screen (only in Safari)
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const installe = navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    if (!ios || installe || etat.astuce) return null;
    const a = el('div', { class: 'astuce' },
      el('p', null, 'Tipp: Tippe oben auf « Teilen » und dann auf « Zum Home-Bildschirm ». Dann ist Tartine wie eine App da – auch ohne Internet.'),
      el('button', { class: 'astuce-x', 'aria-label': 'Tipp schliessen', onclick: () => { etat.astuce = true; sauver(); a.remove(); } }, '✕'));
    return a;
  }

  function reglages() {
    const voile = el('div', { class: 'voile', onclick: e => { if (e.target === voile) voile.remove(); } });
    const choix = (val, txt) => el('button', { class: 'choix' + (etat.sens === val ? ' actif' : ''),
      onclick: () => { etat.sens = val; sauver(); voile.remove(); reglages(); } }, txt);
    voile.append(el('div', { class: 'fenetre', role: 'dialog', 'aria-label': 'Einstellungen' },
      el('h2', null, 'Einstellungen'),
      el('p', null, 'Die Karten zeigen zuerst:'),
      el('div', { class: 'choix-ligne' }, choix('fr', 'Französisch'), choix('de', 'Deutsch')),
      el('p', { class: 'petit' }, 'Deutsch zuerst: selbst überlegen, wie es auf Französisch heisst – dann umdrehen.'),
      bouton('btn-creme', 'Fortschritt löschen', 'alle Sterne und « Je sais ! »', () => {
        if (!window.confirm('Alle Sterne und « Je sais ! » löschen?')) return;
        etat = Object.assign(VIDE(), { sens: etat.sens, astuce: etat.astuce });
        sauver();
        ecranAccueil();
      }),
      el('p', { class: 'petit' }, 'Stand ' + D.version + ' · ' + Object.keys(MOTS).length + ' Wörter'),
      bouton('btn-creme', 'Ton testen', 'Tartine sagt Hallo', () => Son.dire(aT(D.lignes.accueil))),
      el('p', { class: 'petit' }, 'Kein Ton? Lautstärke-Tasten drücken. Auf einem iPhone mit iOS älter als 17 zusätzlich den Stumm-Modus ausschalten.'),
      el('p', { class: 'petit' }, 'Schrift: Nunito (SIL Open Font License, fonts/OFL.txt)'),
      bouton('btn-confiture', 'Fertig', null, () => voile.remove())));
    document.body.append(voile);
  }

  // ---------- a unit: its decks
  function ecranUnite(u) {
    const retour = () => ecranUnite(u);
    nouvelEcran(entete(u.titre + ' · ' + u.nom, u.de, ecranAccueil),
      el('div', { class: 'grille' }, [...u.paquets, paquetTous(u)].map(p => tuilePaquet(p, retour))));
  }
  function tuilePaquet(p, retour) {
    const n = p.ids.length, ok = gekonnt(p.ids);
    return el('div', { class: 'tuile' },
      el('div', { class: 'tuile-haut' },
        el('div', null, el('h2', null, p.titre), el('p', { class: 'tuile-de' }, p.de)),
        p.sansEtoiles ? null : etoiles(etat.etoiles[p.id] || 0)),
      el('p', { class: 'tuile-info' }, n + (n === 1 ? ' Wort' : ' Wörter') + (p.sansEtoiles ? '' : ' · ' + ok + ' gekonnt')),
      p.sansEtoiles ? null : barre(ok, n),
      el('div', { class: 'tuile-boutons' },
        bouton('btn-creme', 'Cartes', 'Karten', () => ecranCartes(p, retour)),
        bouton('btn-confiture', 'Quiz', 'Spiel', () => ecranQuiz(p, retour))));
  }

  // ---------- the cards
  function faceComplete(m) {
    return [
      image(m),
      el('div', { class: 'ligne-son' }, el('p', { class: 'mot-fr' }, coupe(m.fr)), boutonSon('Wort anhören', () => Son.dire(aMot(m)))),
      el('p', { class: 'mot-de' }, coupe(m.de)),
      el('hr'),
      el('div', { class: 'ligne-son' }, el('p', { class: 'satz-fr' }, m.sfr), boutonSon('Satz anhören', () => Son.dire(aSatz(m)))),
      el('p', { class: 'satz-de' }, m.sde),
      m.h ? el('p', { class: 'hinweis' }, m.h) : null];
  }

  function ecranCartes(p, retour) {
    if (p.id === 'difficiles') p = paquetDifficiles();
    if (!p.ids.length) return retour();
    const fr = etat.sens === 'fr';
    const file = ordre(p.ids).slice(0, p.max || p.ids.length);
    const fois = {};
    let i = 0, sus = 0;
    const compteur = el('span', { class: 'compteur' });
    const zone = el('div', { class: 'zone-carte' });
    const actions = el('div', { class: 'actions' });
    const id = nouvelEcran(entete(p.titre, p.de, retour, compteur), zone, actions);

    function montrer() {
      if (id !== ecran) return;
      if (i >= file.length) return fin();
      const m = MOTS[file[i]];
      compteur.textContent = (i + 1) + ' / ' + file.length;
      const recto = el('div', { class: 'face recto' },
        image(m),
        fr ? el('div', { class: 'ligne-son' }, el('p', { class: 'mot-fr grand' }, coupe(m.fr)), boutonSon('Wort anhören', () => Son.dire(aMot(m))))
          : el('p', { class: 'mot-de grand' }, coupe(m.de)),
        fr ? null : el('p', { class: 'question-de' }, 'Wie heisst das auf Französisch?'),
        el('p', { class: 'tippe' }, 'Tippe auf die Karte'));
      const carte = el('div', { class: 'carte entre', role: 'button', tabindex: '0', 'aria-label': 'Karte umdrehen' },
        el('div', { class: 'carte-int' }, recto, el('div', { class: 'face verso' }, faceComplete(m))));
      let tournee = false;
      function tourner() {
        tournee = !tournee;
        carte.classList.toggle('tournee', tournee);
        if (!tournee) return Son.stop();
        actions.classList.add('visible');
        if (fr) Son.dire(aSatz(m)); else Son.dire(aMot(m), 600, aSatz(m));   // like the word card in the game
      }
      carte.addEventListener('click', tourner);
      carte.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tourner(); } });
      zone.replaceChildren(carte);
      actions.classList.remove('visible');
      actions.replaceChildren(
        bouton('btn-encore', 'Encore', 'Nochmal', () => {
          descendre(m.id);
          fois[m.id] = (fois[m.id] || 0) + 1;
          if (fois[m.id] <= 2) file.splice(Math.min(i + 4, file.length), 0, m.id);   // comes again after three other cards
          i++; montrer();
        }),
        bouton('btn-sais', 'Je sais !', 'Kann ich', () => { monter(m.id); sus++; i++; montrer(); }));
      if (fr) Son.dire(aMot(m)); else Son.stop();
    }

    function fin() {
      const l = ligne('Richtig');
      compteur.textContent = '';
      zone.replaceChildren(el('div', { class: 'fin' },
        el('img', { class: 'fin-tartine', src: 'img/tartine.webp', width: 398, height: 560, alt: '' }),
        bulle(l),
        el('p', { class: 'fin-texte' }, file.length + ' Karten geübt – ' + sus + ' × « Je sais ! »')));
      actions.classList.add('visible');
      actions.replaceChildren(
        bouton('btn-creme', 'Encore une fois', 'Nochmal', () => ecranCartes(p, retour)),
        bouton('btn-confiture', 'Quiz', 'Spiel', () => ecranQuiz(p, retour)),
        bouton('btn-creme', 'Retour', 'Zurück', retour));
      Son.dire(aT(l));
    }
    montrer();
  }

  // ---------- the quiz: like the station quiz in the game – no way to fail, a wrong word comes again at the end
  function ecranQuiz(p, retour) {
    if (p.id === 'difficiles') p = paquetDifficiles();
    if (!p.ids.length) return retour();
    const panneau = el('div', { class: 'quiz' });
    const id = nouvelEcran(entete(p.titre, p.de, retour), panneau);
    const debut = D.lignes.quiz;
    panneau.replaceChildren(
      bulle(debut, 'quiz'),
      el('p', { class: 'quiz-mot' }, 'Prêt pour le quiz ?'),
      el('div', { class: 'reponses' },
        el('button', { class: 'reponse', onclick: commencer }, 'Oui, c\'est parti !'),
        el('button', { class: 'reponse', onclick: () => retour() }, 'Pas encore')));
    Son.dire(aT(debut));

    function commencer() {
      const file = melanger(ordre(p.ids).slice(0, Math.min(QUIZ_MAX, p.ids.length)))
        .map((mid, k) => ({ id: mid, type: k % 2 ? 'WieSagtMan' : 'WasHeisst' }));
      const total = file.length, fautes = new Set(), repet = {};
      let q = 0;

      function poser() {
        if (id !== ecran) return;
        if (q >= file.length) return fin();
        const item = file[q], m = MOTS[item.id], fr = item.type === 'WasHeisst';
        const l = ligne(item.type);
        const options = melanger([m, ...leurres(m, 2)]);
        let b0 = bulle(l, 'quiz'), repondu = false;
        const boutons = options.map(o => el('button', { class: 'reponse', onclick: e => repondre(o, e.currentTarget) }, coupe(fr ? o.de : o.fr)));

        async function repondre(o, b) {
          if (repondu) return;
          repondu = true;
          const juste = o.id === m.id;
          boutons.forEach((x, k) => { x.disabled = true; if (options[k].id === m.id) x.classList.add('juste'); });
          if (!juste) b.classList.add('faux');
          if (juste) { if (!repet[m.id]) monter(m.id); } else {
            descendre(m.id);
            fautes.add(m.id);
            repet[m.id] = (repet[m.id] || 0) + 1;
            if (repet[m.id] <= 2) file.push({ id: m.id, type: item.type });
          }
          const l2 = ligne(juste ? 'Richtig' : 'Falsch');
          const b1 = bulle(l2, 'quiz');
          b0.replaceWith(b1); b0 = b1;
          await Son.dire(aT(l2), 250, aMot(m));
          await attendre(700);
          if (id !== ecran) return;
          q++; poser();
        }

        panneau.replaceChildren(
          b0,
          el('div', { class: 'ligne-son' }, el('p', { class: 'quiz-mot' }, coupe(fr ? m.fr : m.de)),
            fr ? boutonSon('Wort anhören', () => Son.dire(aMot(m))) : null),
          el('div', { class: 'reponses' }, boutons),
          el('div', { class: 'points' }, file.map((_, k) => el('span', { class: k < q ? 'fait' : k === q ? 'ici' : null }))));
        Son.dire(aT(l), fr ? 250 : null, fr ? aMot(m) : null);
      }

      function fin() {
        const f = fautes.size, n = f === 0 ? 3 : f <= 2 ? 2 : 1;      // stars like in the game
        if (!p.sansEtoiles) { etat.etoiles[p.id] = Math.max(etat.etoiles[p.id] || 0, n); sauver(); }
        const l = ligne('Richtig');
        panneau.replaceChildren(
          bulle(l, 'quiz'),
          etoiles(n, true),
          el('p', { class: 'quiz-resultat' }, 'Beim ersten Mal richtig: ' + (total - f) + ' von ' + total),
          el('div', { class: 'reponses' },
            el('button', { class: 'reponse', onclick: () => ecranQuiz(p, retour) }, 'Rejouer'),
            el('button', { class: 'reponse', onclick: () => ecranCartes(p, retour) }, 'Cartes'),
            el('button', { class: 'reponse', onclick: () => retour() }, 'Retour')));
        Son.dire(aT(l));
      }
      poser();
    }
  }

  // ---------- offline (only over https or on this PC)
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    const avait = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (avait) location.reload(); });   // a new version
  }

  ecranAccueil();
})();
