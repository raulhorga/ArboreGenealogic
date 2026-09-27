

## Export v12

- **Excel**: descarcă starea actuală a persoanelor, relațiilor, generațiilor și pozițiilor într-un fișier `.xls` compatibil cu Microsoft Excel.
- **JPEG**: descarcă o imagine a întregului arbore ocupat, independent de zoom-ul sau poziția curentă din ecran.


## Corecție JPEG v12

Exportul JPEG este randat direct într-un canvas, fără SVG `foreignObject`, pentru compatibilitate mai bună între browsere. Sunt incluse persoanele, fotografiile disponibile și legăturile părinte–copil, partener și frați/surori.


## Fix export JPEG in v12

Exportul JPEG nu mai folosește metoda problematică din versiunile anterioare. Imaginea arborelui este randată direct într-un canvas și se descarcă drept fișier `.jpeg`, incluzând întreg layout-ul actual al arborelui.
