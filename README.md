# Virtueller Schreibtisch

Eine lokale Desktop-App zur Dokumentenverwaltung und Haushaltsbuchführung – gebaut mit Electron.

## Features

### Schreibtisch
- Dokumente in 4 Kategorien organisieren: Rechnungen & Finanzen, Verträge & Versicherungen, Behörden & Behördenpost, Persönliches & Sonstiges
- Ordner verknüpfen und automatisch scannen
- Dokumente per Drag & Drop oder Dateiauswahl hinzufügen
- Volltextsuche über alle Dokumente
- Dokumente direkt öffnen oder im Explorer anzeigen

### Haushaltsbuch
- Einnahmen und Ausgaben als Karten erfassen
- Wiederkehrende Einträge (monatlich, quartalsweise, jährlich) mit automatischer Seriengenerierung
- Einzeleintrag nachträglich in eine Serie umwandeln
- Serien ab einem bestimmten Monat löschen
- Monatsnavigation mit Alle-Ansicht (gestapelte Karten bei gleichem Namen)
- Bezahlt/Ausstehend Status mit Zusammenfassungsleiste
- Filter nach Einnahmen, Ausgaben, Bezahlt, Ausstehend

### Allgemein
- Zwei Themes: Latte (hell, Catppuccin) und Dark (dunkel, Catppuccin Mocha)
- Alle Daten werden lokal gespeichert – keine Cloud, keine Abhängigkeiten

## Installation

```bash
npm install
npm start
```

Voraussetzung: [Node.js](https://nodejs.org) und npm.

## Datenspeicherung

Alle Daten (Metadaten, verknüpfte Ordner, Haushaltsbuch-Einträge) werden lokal gespeichert unter:

- **Windows:** `%APPDATA%\virtueller-schreibtisch\metadata.json`
- **macOS:** `~/Library/Application Support/virtueller-schreibtisch/metadata.json`
- **Linux:** `~/.config/virtueller-schreibtisch/metadata.json`

## Lizenz

The Unlicense – siehe [LICENSE](LICENSE)
