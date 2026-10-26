# Änderungen

## 0.9.6 – 2026-10-26

### Neu
- Gelöschte Projekte unter „Gelöschte Projekte“ aufbewahrt, zum Wiederherstellen oder endgültigen Löschen; nach 30 Tagen oder so vielen, wie der Admin einstellt, gehen sie mit allen Daten. Die Dateien bleiben.
- Gelöschtes Projekt wieder angeboten, wenn sein Ordner oder eine seiner Dateien wieder ins Review soll.

### Geändert
- Projekt wird gelöscht, statt seine Assets nach „Ohne Projekt“ zu verschieben.
- In den Einstellungen eines Review-Links erklärt, was „ohne Downloads“ und das Wasserzeichen bewirken.
- ffmpeg und ffprobe auf lokale Dateien in den Formaten beschränkt, die Deliver aufnimmt.
- Playlists (M3U, PLS) vom Review ausgenommen.
- Ableton Live Sets abgelehnt, die entpackt größer als 100 MB sind.
- Anhänge auf zusammen 20 MB je Person und Version begrenzt, einstellbar in den Admin-Einstellungen.
- Lesbarkeit des Codes verbessert.

### Behoben
- Version für Mitglieder geschlossen, die ihre Datei nicht öffnen können, auch wenn sie eine andere Version des Stapels öffnen.
- Formeln aus Kommentaren und Reviewer-Namen im CSV-Export entschärft.
- Einladen oder Umbenennen auf den Namen eines Reviewers abgelehnt, der auf keinem Link des Projekts ist.
- Review-Link auf ein Asset auch in der Dateien-Seitenleiste eines Ordnerprojekts nach dem Asset benannt.
- Abgelaufenen Review-Link in seinen Einstellungen als abgelaufen gezeigt.
- Projektansicht verlassen, sobald das Projekt aus seinen Einstellungen gelöscht ist.
- Daten auch für Sprachen mit Region angezeigt, etwa Deutsch (Sie), statt abzubrechen.
- Benachrichtigungen über eine Version entfernt, sobald sie gelöscht ist.
- Ohne Download freigegebene Dateien aus den Downloads von Review-Links und dem WAV-Export herausgehalten, und ganz von Review-Links, wo Nextcloud ihren Inhalt verbirgt.

## 0.9.5 – 2026-10-24

### Neu
- Beim Einladen von Reviewern die Reviewer des Projekts und Kontakte mit ihren Bildern vorgeschlagen.
- „In Kontakte speichern“ im Menü eines Reviewers hinzugefügt.
- Deliver-Einstellungen mit dem Adressbuch für gespeicherte Reviewer hinzugefügt.
- Plus neben „Reviewer“ hinzugefügt, das eine Person über einen eigenen Review-Link einlädt.
- „Auf anderen Review-Link setzen“ und „Von diesem Link nehmen“ hinzugefügt.
- Reviewer in der Navigation mit Initialen gezeigt; unter einem Link öffnet ein Klick ihre Rechte darauf.

### Geändert
- „Review-Link erstellen“ als Plus neben „Links“ verschoben.
- Review-Links nach ihrem Inhalt benannt.
- E-Mail-Adresse auf einen Reviewer pro Projekt beschränkt.
- Jedem Persönlichen Link einen eigenen Schlüssel gegeben, der nur seinen Review-Link öffnet. Persönliche Links, die 0.9.2 für einen nie geöffneten Link verschickt hat, funktionieren nicht mehr; den Reviewer dort erneut auf den Link setzen.
- Eigene Rechte eines Reviewers auf die einzelnen Review-Links verlegt.
- Alle Reviewer des Projekts gelistet, mit oder ohne Link.
- Name und Adresse eines Reviewers auf mehreren Links nur noch durch das einladende Mitglied änderbar gemacht.
- Projekt-Links in Review-Links umbenannt.

### Behoben
- Beim Selbstbenennen gesagt, ob der Name oder die Adresse schon vergeben ist.
- Abgelaufene Review-Links in der Navigation wie pausierte behandelt.

## 0.9.2 – 2026-10-22

- Reviewer gehören zum Projekt des Links, über den sie kamen: die Einstellungen eines Links zeigen nur sie, und ihr Persönlicher Link und ihre Mails bleiben in diesem Projekt. Wer schon mehrere Projekte reviewt hat, behält das erste; für die anderen lädst du sie neu ein.

## 0.9.1 – 2026-10-22

- Cron-Jobs nicht mehr als zeitunkritisch markiert.
- Ausrichtung der Icons auf der minimierten Upload-Karte korrigiert.

## 0.9.0 – 2026-10-21

### Neu
- Uploads-Dialog: eine Warteschlange für alle Uploads in Deliver, eine Datei nach der anderen, läuft beim Wechsel der Ansicht weiter.
- „Im Hintergrund weiter“: der Dialog wird zur Karte (auf Telefonen zur Leiste).
- Uploads in Teilen: pausieren offline, wiederholen fehlgeschlagene Teile, setzen nach dem Neuladen fort.
- Fortschritt mit Geschwindigkeit und Restzeit, danach der Stand von Wellenform, Proxy und Vorschauleiste.
- Uploads erscheinen in jedem offenen Tab und lassen sich aus jedem abbrechen.
- Ohne ffmpeg erstellt der hochladende Browser die Wellenform schon während des Uploads.
- Formatliste im Dialog: was direkt abspielt, was ffmpeg braucht.
- „Verarbeitung fehlgeschlagen“ auf Asset-Karten; „Erneut verarbeiten“ im Asset-Menü und in der Upload-Liste.
- Asset-Karten auswählen: Checkbox, Strg/Cmd-Klick, Umschalt-Klick, alle auswählen.
- Menü für ausgewählte Assets: Erneut verarbeiten, Fälligkeitsdatum, In Projekt verschieben, Entfernen, Löschen.
- Asset löschen: die Dateien aller Versionen gehen in den Papierkorb, das Asset mit seinen Review-Daten. Auch fehlende Assets.
- „Neues Projekt“ legt einen Projektordner an, unter `/Deliver` oder am Ort aus Verwaltung → Deliver.
- API: `DELETE /assets/{id}/files`.

### Geändert
- Klick auf eine Karte wählt sie aus, Doppelklick öffnet das Review.
- Proxies haben mindestens 720p.

### Behoben
- Telefon: Tippen eines Kommentars hält die Wiedergabe an, und der Anker passt zum gezeigten Frame.

## 0.8.4 – 2026-10-13

- Jede Karte hat neben ihrem Namen einen „…“-Knopf, auf jedem Bildschirm, der dasselbe Menü öffnet wie ein Rechtsklick oder langes Drücken. Die Einstellungen eines Projekts sind vom Zahnrad in dieses Menü gewandert.
- Asset-Karten zeigen Version, Abnahme, Kommentare und Laufzeit in den Ecken ihres Standbilds, „Fehlt“ oder „Wird verarbeitet“ anstelle der Laufzeit, unter dem Namen, wann die neueste Version kam, und beim Zeigen auf den Namen den Dateinamen.
- Mediendateien in einem Ordnerprojekt, die nicht im Review sind, haben ein eigenes Menü: zum Review hinzufügen, als neue Version eines Assets derselben Art hinzufügen, herunterladen, umbenennen und in Dateien zeigen. Auch das Menü eines Assets kann die Datei der neuesten Version herunterladen und umbenennen. Beim Umbenennen bleibt die Dateiendung, damit eine Datei nie ihre Art wechselt.
- Ein entferntes Asset bleibt mit seinen Dateien aus der Automatischen Aufnahme heraus, auch nach Umbenennen, Verschieben im Ordner, Überschreiben oder Aus- und Einschalten der Automatischen Aufnahme. Die Dateien warten unter „Nicht im Review“, bis jemand sie wieder hinzufügt. Das gilt auch in der Seitenleiste von Dateien, wo sich „Review in Deliver“ jetzt auch für eine Datei in einem Ordner mit Automatischer Aufnahme ausschalten lässt. „Aus Deliver herausnehmen“ heißt jetzt „Aus Projekt entfernen“, Ohne Projekt „Aus Deliver entfernen“.
- Wird ein entferntes Projekt aus seinem Ordner neu angelegt, bekommt es seine Assets samt Kommentaren aus Ohne Projekt zurück.
- Bestätigungen wachsen mit ihrer Überschrift, damit die deutschen hineinpassen.
- API: `POST /assets` nimmt eine `assetId` und fügt die Datei in einem Schritt als nächste Version dieses Assets hinzu.

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
