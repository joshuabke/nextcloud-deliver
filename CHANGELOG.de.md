# Änderungen

## 0.8.3 – 2026-10-09

- Reviewer haben ein eigenes Menü unter ihrem Avatar oben im Review, wie bei Frame.io: Name und Adresse ändern, wählen, was gemailt wird, zwischen Deutsch und Englisch wechseln und die Sitzung beenden, damit sich die nächste Person neu einträgt.
- Wer sich mit Name und Adresse eines bestehenden Reviewers einträgt, bekommt dessen Persönlichen Link an diese Adresse gemailt und ist über das Postfach wieder im Review. Zwei Reviewer dürfen gleich heißen; ihre Avatare unterscheiden sich in der Farbe. Der Name eines Members bleibt vergeben, und eingeladene oder umbenannte Reviewer brauchen weiterhin einen eigenen Namen.
- Mails an Reviewer kommen in der Sprache, in der sie reviewen.
- Eine später angegebene Adresse bekommt den Persönlichen Link ebenfalls per Mail.

## 0.8.2 – 2026-10-06

- Wer sich auf einem Link mit E-Mail-Adresse einträgt, bekommt den Persönlichen Link sofort per Mail statt eines Hinweises, ihn als Lesezeichen zu speichern.
- Beim Einladen eines Reviewers lässt sich der Persönliche Link per Mail schicken, mit einer eigenen Nachricht; Antworten gehen an die eigene Adresse.
- Namen im Review sind eindeutig: Eintragen, Einladen und Umbenennen lehnen einen Namen ab, den schon ein Member der geteilten Dateien oder ein anderer Reviewer des Projekts trägt.
- Das Eintragen auf einem Link ist begrenzt, damit sich über einen Link nicht massenhaft Mails an Fremde verschicken lassen.

## 0.8.1 – 2026-10-06

- Nextcloud 35 wird unterstützt.
- Wird ein Nextcloud-Konto gelöscht, erbt ein später unter derselben Benutzer-ID angelegtes Konto nicht mehr dessen Projekte, Links und Reviewer. Ein Ordnerprojekt geht an den Eigentümer des Ordners, andere Projekte werden entfernt und ihre Assets bleiben Ohne Projekt erhalten; Kommentare und Abnahmen des Kontos bleiben erhalten und stehen dann unter „Gelöschter Benutzer“.
- Die App-Store-Seite zählt auf, was Deliver kann, auf Englisch und Deutsch.
- Neue Screenshots und eine README mit den Funktionen auf einen Blick, einer Screenshot-Galerie und einer Übersicht, wie Deliver bei Nextcloud-Anbietern läuft.

## 0.8.0 – 2026-10-05

Erste Veröffentlichung im App Store, als Vorabversion: Probier sie an echten Projekten aus, aber behalte eigene Backups und rechne mit Ecken und Kanten. Rückmeldungen gehen in die GitHub-Issues.

- Eine Video-, Audio- oder Bilddatei in der Dateien-Seitenleiste zum Review freigeben, in ein Projekt nach Wahl oder in keins, oder einen ganzen Ordner zum Projekt machen, das jede Mediendatei darin aufnimmt. Projekte sammeln Dateien von überall, und wer eine Datei öffnen kann, sieht ihr Review. Dateien bleibt die Quelle der Wahrheit: Nichts wird kopiert oder verschoben, und eine überschriebene Datei behält ihre Kommentare und wird neu eingelesen.
- Kommentare auf einem Frame oder Bereich, mit Antworten, Zeichnungen, Erwähnungen, Reaktionen und Anhängen, und Erledigt, sobald sie umgesetzt sind.
- Versionsstapel für die Fassungen eines Schnitts, und zwei Versionen nebeneinander oder unter einem Wischer, synchron abgespielt.
- Abnahme: eine Version abnehmen oder Änderungen wünschen, und alle sehen, wer was entschieden hat.
- Review für Externe über Projekt-Links, Delivers eigene Links für ein ganzes Projekt oder ausgewählte Assets, wo auch immer die Dateien liegen, und für einzelne Dateien Ohne Projekt: Passwort, Ablaufdatum, Pause, Kommentare, Download, nur die neueste Version, eine Beschreibung über einem Raster der Assets mit Download einzeln, als ZIP aller oder der ausgewählten, und wer was geöffnet, angesehen und heruntergeladen hat. Jeder Reviewer bekommt einen Persönlichen Link, eigene Rechte und auf Wunsch ein Wasserzeichen mit seinem Namen. Ein Mitglied, das einen Link öffnet, sieht schreibgeschützt, was Reviewer sehen, mit dem Weg in Deliver. Freigaben in Dateien bleiben gewöhnliche Nextcloud-Freigaben.
- Fälligkeitsdaten mit Erinnerung, ungesehene Kommentare, Benachrichtigungen und Mails, und Live-Aktualisierung ohne Neuladen.
- Export der Kommentare als EDL, FCP7 XML, FCPXML oder CSV, als Marker für den Schnitt.
- Audio zählt auf die Millisekunde: angezeigt als `m:ss.mmm`, umschaltbar auf Timecode oder Frames in der Bildrate des Projekts.
- Proxys, Vorschauleisten und Wellenformen, wenn ffmpeg installiert ist; ohne ffmpeg spielen browsertaugliche Dateien so, wie sie sind, MOV, MP4 und Broadcast-WAV behalten Bildrate und Start-Timecode, eine MP3, FLAC oder M4A den Start, den das liefernde Werkzeug in ihren Tag geschrieben hat, eine FLAC ihre Dauer, WebM und MKV ihre Bildrate, und Audio bekommt trotzdem seine Wellenform.
- Mit der Maus über das Vorschaubild durch ein Video scrubben, in Deliver und auf der Startseite eines Links; ohne ffmpeg auf dem Server steht ein Frame des Videos statt des Vorschaubilds.
- Funktioniert auf dem Handy: Review-Ansicht, Zeichnen mit dem Finger und die Projektliste sind für kleine Bildschirme gemacht.
- Fehlersuche ohne Shell: Prüfungen in der Verwaltungsübersicht, fehlgeschlagene Medienjobs im Nextcloud-Protokoll und aus den Deliver-Einstellungen wiederholbar, und ein Support-Bericht für Fehlermeldungen.
- Englisch und Deutsch.
