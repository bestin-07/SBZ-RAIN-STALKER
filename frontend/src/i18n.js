const translations = {
  de: {
    GO_NOW:    'JETZT RAUS',
    WAIT_MIN:  'NOCH {min} MIN',
    STUCK:     'DRINNEN BLEIBEN',
    dry_for:      'noch {min} Minuten trocken',
    dry_for_over: 'mehr als {min} Minuten trocken',
    no_rain:      'kein Regen an deinem Standort',
    then_clear:'dann {min} Minuten trocken',
    no_gap:    'keine Lücke in den nächsten 3 Stunden',

    dry:        'trocken',
    light_rain: 'leichter Regen',
    heavy_rain: 'starker Regen',
    next_12h:   'nächste 12 Std',

    checking:    'PRÜFEN',
    reading_sky: 'Regenradar wird analysiert...',

    pct_accurate: '% genau',

    app_tagline: 'Lücken finden. Rausgehen wenn es zählt.',
    fact_01:     'liest Radardaten, alle 5 Minuten aktualisiert',
    fact_02:     'findet trockene Fenster an deinem genauen Standort',
    fact_03:     'verfolgt wie genau die Vorhersage wirklich ist',
    location_denied:       'Standortzugriff verweigert.',
    location_not_supported:'Standort wird von diesem Browser nicht unterstützt',
    try_again:   'tippe unten um es erneut zu versuchen.',
    get_location:'STANDORT ERMITTELN',
    locating:    'WIRD ERMITTELT',
    privacy:     'Standort bleibt in deinem Browser. Wir speichern nichts.',

    info_title: 'Was ist das?',
    info_p1: 'SBZ Rain Stalker zeigt dir genau wann es aufhört zu regnen — an deinem genauen GPS-Standort, nicht irgendwo in Salzburg.',
    info_p2: 'Das System liest 15-Minuten-Niederschlagsvorhersagen von Open-Meteo (ICON-EU Modell) und sucht nach trockenen Fenstern von mindestens 30 Minuten.',
    info_p3: 'Radar stammt vom Deutschen Wetterdienst (DWD) über das OPERA Netzwerk, das ganz Österreich einschließlich der Alpen abdeckt.',
    info_p4: 'Genauigkeit wird automatisch verfolgt — Vorhersagen werden gespeichert und später mit den tatsächlichen Werten verglichen.',
    data_sources: 'Datenquellen',
    src_forecast: 'Vorhersage',
    src_radar:    'Radar',
    src_accuracy: 'Genauigkeit',
    outside_sbz: 'Du bist außerhalb von Salzburg — Radarkarte zeigt möglicherweise falsche Region',

    notify_on:  '◉',
    notify_off: '◎',
    notify_denied: 'blockiert',
    notify_unsupported: 'kein Push',

    install_title: 'App installieren',
    install_brave: 'Brave oder Samsung Browser: Menü (⋮) dann "Zum Startbildschirm hinzufügen"',
    install_safari: 'Safari auf iOS: Teilen-Symbol tippen dann "Zum Home-Bildschirm"',
    install_note: 'Nach der Installation öffnet die App ohne Adressleiste wie eine native App.',

    privacy_title: 'Datenschutz',
    privacy_1: 'Dein GPS-Standort verlässt deinen Browser nur als Koordinaten direkt an Open-Meteo (Schweiz, FADP-konform). Wir erhalten und speichern deinen Standort nicht.',
    privacy_2: 'Im Browser werden ausschließlich Design- und Spracheinstellungen gespeichert. Keine Tracking-Cookies, kein Benutzerkonto.',
    privacy_3: 'Für Push-Benachrichtigungen speichern wir ein anonymes Browser-Token ohne Standortbezug. Abmelden jederzeit möglich.',
    privacy_basis: 'Rechtsgrundlage: berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO) für die Wetterabfrage; Einwilligung für Push.',

    close: 'SCHLIESSEN',
  },
  en: {
    GO_NOW:    'GO NOW',
    WAIT_MIN:  'WAIT {min} MIN',
    STUCK:     'STUCK INSIDE',
    dry_for:      'dry for {min} more minutes',
    dry_for_over: 'dry for more than {min} minutes',
    no_rain:      'no rain at your location',
    then_clear:'then {min} minutes clear',
    no_gap:    'no gap in the next 3 hours',

    dry:        'dry',
    light_rain: 'light rain',
    heavy_rain: 'heavy rain',
    next_12h:   'next 12 hours',

    checking:    'CHECKING',
    reading_sky: 'reading the sky over your location',

    pct_accurate: '% accurate',

    app_tagline: 'find the gaps. step out when it counts.',
    fact_01:     'reads radar data updated every 5 minutes',
    fact_02:     'finds dry windows at your exact location',
    fact_03:     'tracks how accurate the forecast actually is',
    location_denied:       'location access denied.',
    location_not_supported:'geolocation not supported by this browser',
    try_again:   'tap below to try again.',
    get_location:'GET MY LOCATION',
    locating:    'LOCATING',
    privacy:     'location stays in your browser. nothing is stored on our end.',

    info_title: 'What is this?',
    info_p1: 'SBZ Rain Stalker tells you exactly when the rain stops — at your precise GPS location, not somewhere in Salzburg.',
    info_p2: 'The system reads 15-minute precipitation forecasts from Open-Meteo (ICON-EU model) and looks for dry windows of at least 30 minutes.',
    info_p3: 'Radar comes from the German Weather Service (DWD) via the OPERA network, which covers all of Austria including the Alps.',
    info_p4: 'Accuracy is tracked automatically — predictions are stored and later checked against actual readings.',
    data_sources: 'Data sources',
    src_forecast: 'Forecast',
    src_radar:    'Radar',
    src_accuracy: 'Accuracy',
    outside_sbz: 'You are outside Salzburg — radar map may show the wrong region',

    notify_on:  '◉',
    notify_off: '◎',
    notify_denied: 'blocked',
    notify_unsupported: 'no push',

    install_title: 'Install app',
    install_brave: 'Brave or Samsung Browser: menu (⋮) then "Add to home screen"',
    install_safari: 'Safari on iOS: tap the share icon then "Add to Home Screen"',
    install_note: 'Once installed the app opens without an address bar like a native app.',

    privacy_title: 'Privacy',
    privacy_1: 'Your GPS coordinates leave your browser only as a direct request to Open-Meteo (Switzerland, FADP-compliant). We never receive or store your location.',
    privacy_2: 'Only theme and language preferences are saved locally in your browser. No tracking cookies, no account.',
    privacy_3: 'For push notifications we store an anonymous browser token with no location attached. Unsubscribe at any time.',
    privacy_basis: 'Legal basis: legitimate interest (Art. 6(1)(f) GDPR) for weather lookup; consent for push notifications.',

    close: 'CLOSE',
  },
}

export function useI18n(lang) {
  const strings = translations[lang] ?? translations.de
  return function t(key, vars = {}) {
    let str = strings[key] ?? key
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(`{${k}}`, String(v))
    }
    return str
  }
}
