# Arbore genealogic interactiv — EtherCalc

Aplicație statică pentru construirea și sincronizarea unui arbore genealogic modern.

## EtherCalc

Datele sunt salvate în `https://ethercalc.net/=k3im7605mgvf` (room ID `k3im7605mgvf`).

## Funcții

- adăugare, editare și ștergere persoane;
- fotografie pentru fiecare persoană;
- relații tată, mamă și partener;
- legături părinte → copil desenate automat;
- legături vizuale între frați și surori, deduse automat când două persoane au cel puțin un părinte comun;
- cardurile persoanelor pot fi mutate prin drag & drop;
- pozițiile cardurilor sunt salvate în EtherCalc (`posX`, `posY`);
- pan pe fundal și zoom cu rotița mouse-ului;
- butoane zoom, încadrare automată și aranjare automată pe generații;
- căutare după persoană, localitate, notițe și rude;
- sincronizare automată cu EtherCalc.

## Relația dintre frați

Nu trebuie introdus un câmp separat „frate/soră”. Aplicația consideră două persoane frați/surori dacă au același `fatherId` sau același `motherId`. Astfel, relația se actualizează automat când modifici părinții.

## Publicare

Încarcă `index.html`, `styles.css`, `app.js` și `README.md` în repository și activează GitHub Pages din **Settings → Pages**.

## Confidențialitate

EtherCalc nu este recomandat pentru date sensibile. Evită CNP-uri, adrese exacte, telefoane, date medicale, acte sau alte informații private.


## Generații și vârstă

- fiecare persoană poate avea generația calculată automat din părinți sau setată manual;
- mutarea unui card pe verticală într-o altă bandă schimbă și salvează generația persoanei;
- la editare, generația poate fi aleasă explicit din formular;
- vârsta este calculată automat din data nașterii; pentru persoanele decedate se calculează vârsta la data decesului.


## Versiunea v4

- vârsta este calculată automat din data nașterii și data decesului;
- fiecare card afișează generația curentă;
- generația poate fi schimbată prin drag & drop între benzile generaționale;
- generația poate fi schimbată și direct cu butoanele `Gen −` și `Gen +` de pe card;
- schimbarea este salvată în EtherCalc în câmpul `manualGeneration`.


## Aranjare automată v5

Aranjarea automată grupează acum membrii pe ramuri familiale: frații/surorile cu aceiași părinți sunt ținuți împreună, partenerii sunt păstrați aproape, iar copiii sunt centrați cât mai mult sub părinții lor. Familiile diferite primesc spațiu suplimentar între ele.


## Aranjare automată v6

La aranjarea automată, partenerii/soții din aceeași generație sunt tratați ca o singură unitate și sunt poziționați imediat unul lângă altul. Copiii rămân grupați sub ramura familială, iar familiile diferite primesc spațiu suplimentar între ele.


## Versiunea v7

- câmp opțional „Poreclă” pentru fiecare persoană;
- porecla apare pe card, dacă este completată;
- căutarea găsește persoanele și după poreclă.


## v8 — Full Screen și Mobile View

- buton **Full screen** pentru a extinde canvasul genealogic pe tot ecranul;
- buton **Mobile view** pentru carduri și controale compacte, optimizate pentru telefon;
- comutarea modurilor păstrează drag & drop, zoom, pan, relațiile și aranjarea automată;
- la intrarea/ieșirea din full screen arborele este reîncadrat automat.


## Navigare v9

- fundalul canvasului este folosit exclusiv pentru pan;
- persoanele se mută numai din mânerul ⋮⋮ al cardului, pentru a evita mutările accidentale;
- pan-ul este blocat în timpul mutării unei persoane;
- zoom-ul cu rotița este progresiv și centrat pe cursor;
- după mutare, persoana se fixează în banda generației și poziția este salvată în EtherCalc.
