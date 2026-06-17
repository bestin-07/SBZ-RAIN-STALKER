const translations = {
  de: {
    GO_NOW:       'GEMMA RAUS',
    WAIT_MIN:     'NOCH {min} MIN',
    STUCK:        'BLEIB DRIN',
    dry_for:      'noch {min} Minuten trocken',
    dry_for_over: 'mehr als {min} Minuten trocken',
    no_rain:      'kein Regen an deinem Standort',
    then_clear:   'dann {min} Minuten trocken',
    no_gap:       'keine Lücke in den nächsten 3 Stunden',

    dry:        'trocken',
    light_rain: 'leichter Regen',
    heavy_rain: 'starker Regen',
    next_12h:   'nächste 12 Std',

    checking:    'PRÜFEN',
    reading_sky: 'Regenradar wird analysiert...',

    pct_accurate: '% genau',

    app_tagline: 'ab raus. immer mit dem richtigen timing.',
    fact_01:     'liest Radardaten alle 5 Minuten aktualisiert',
    fact_02:     'findet trockene Fenster an deinem genauen Standort',
    fact_03:     'verfolgt wie genau die Vorhersage wirklich ist',
    location_denied:        'Standortzugriff verweigert.',
    location_not_supported: 'Standort wird von diesem Browser nicht unterstützt',
    try_again:   'tippe unten um es erneut zu versuchen.',
    get_location:'STANDORT ERMITTELN',
    locating:    'WIRD ERMITTELT',
    privacy:     'Standort bleibt in deinem Browser. Wir speichern nichts.',
    made_with_love: 'Für Salzburg, mit Liebe',

    info_title: 'Über Gemma Raus',
    info_p1: 'Gemma Raus zeigt dir genau wann du rausgehen kannst, an deinem GPS-Standort. Regen, Temperatur und Wind werden berücksichtigt.',
    info_p2: 'Das System liest 15-Minuten-Niederschlagsvorhersagen von Open-Meteo (ICON-EU Modell) und sucht nach trockenen Fenstern von mindestens 30 Minuten.',
    info_p3: 'Animiertes Radar kommt von RainViewer (europäisches Komposit, ca. 40 Minuten Verlauf plus Kurzfrist-Nowcast).',
    info_p4: 'Als unabhängige Messquelle werden die nächstgelegenen GeoSphere Austria TAWES-Stationen abgefragt — alle 10 Minuten aktualisierte Echtzeitmessungen, kein Modell. Salzburg Flughafen ist immer dabei.',
    info_p5: 'Zusätzlich liefert die GeoSphere INCA-Analyse (radar- und stationsgestützt, 1 km Raster) den Niederschlag direkt an deinem Standort. So wird Regen erkannt bevor das Vorhersagemodell ihn sieht.',
    info_p6: 'Genauigkeit wird automatisch verfolgt, Vorhersagen werden gespeichert und später mit den tatsächlichen Werten verglichen.',
    data_sources: 'Datenquellen',
    src_forecast: 'Vorhersage',
    src_radar:    'Radar',
    src_station:  'Messstationen',
    src_radar_pt: 'Radar-Punkt',
    src_accuracy: 'Genauigkeit',
    outside_sbz: 'Du bist außerhalb von Salzburg, Radarkarte zeigt möglicherweise falsche Region',

    notify_on:          '◉',
    notify_off:         '◎',
    notify_denied:      'blockiert',
    notify_unsupported: 'kein Push',

    install_title:  'App installieren',
    install_brave:  'Brave oder Samsung Browser: Menü (⋮) dann "Zum Startbildschirm hinzufügen"',
    install_safari: 'Safari auf iOS: Teilen-Symbol tippen dann "Zum Home-Bildschirm"',
    install_note:   'Nach der Installation öffnet die App ohne Adressleiste wie eine native App.',

    privacy_title: 'Datenschutz',
    privacy_1: 'Dein GPS-Standort verlässt deinen Browser nur als Koordinaten direkt an Open-Meteo (Schweiz FADP-konform). Wir erhalten und speichern deinen Standort nicht.',
    privacy_2: 'Im Browser werden ausschließlich Design und Spracheinstellungen gespeichert. Keine Tracking-Cookies kein Benutzerkonto.',
    privacy_3: 'Für Push-Benachrichtigungen speichern wir ein anonymes Browser-Token ohne Standortbezug. Abmelden jederzeit möglich.',
    privacy_basis: 'Rechtsgrundlage: berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO) für die Wetterabfrage; Einwilligung für Push.',

    close: 'SCHLIESSEN',

    guide_title:      'was bedeutet was',
    guide_what_is:    '"gemma raus" ist österreichisch für "gehen wir raus!" ein satz der alles sagt.',
    guide_green:      'gerade trocken. einfach raus jetzt.',
    guide_yellow:     'es regnet gerade. aber eine trockene lücke kommt bald. app zeigt wie lange du noch warten musst.',
    guide_red:        'keine trockene lücke in den nächsten 3 stunden. heute drinbleiben ist okay.',
    guide_weather:    'unter dem status gibt es hinweise zu temperatur, wind oder schnee. immer basierend auf deinem standort.',
    guide_ex_wait:    'NOCH 12 MIN',
    guide_ex_stuck:   'BLEIB DRIN',
    guide_disclaimer: 'Vorhersagen kommen von Open-Meteo (ICON-EU Modell) und Radar vom DWD. Beides Open Source und kostenlos. Alpen-Radar kann abweichen und Vorhersagen sind keine Garantie. Im Zweifel kurz aus dem Fenster schauen.',

    weather_perfect:   'ideales wetter heute. kein einziger grund drinzubleiben.',
    weather_hot:       '{temp}°C da draußen. sonnenbrille an und los!',
    weather_scorching: 'heiß! {temp}°C. sonnencreme wasser und dann gemma.',
    weather_cold:      '{temp}°C draußen. jacke nicht vergessen.',
    weather_freezing:  'nur {temp}°C aber frische luft tut gut.',
    weather_windy:     '{wind} km/h wind. haare werden wild. egal!',
    weather_storm:     'sturm! {wind} km/h. netflix heute erlaubt.',
    weather_snow:      'es schneit! winterschuhe an und trotzdem raus.',
  },
  en: {
    GO_NOW:       'GEMMA RAUS',
    WAIT_MIN:     'WAIT {min} MIN',
    STUCK:        'STUCK INSIDE',
    dry_for:      'dry for {min} more minutes',
    dry_for_over: 'dry for more than {min} minutes',
    no_rain:      'no rain at your location',
    then_clear:   'then {min} minutes clear',
    no_gap:       'no gap in the next 3 hours',

    dry:        'dry',
    light_rain: 'light rain',
    heavy_rain: 'heavy rain',
    next_12h:   'next 12 hours',

    checking:    'CHECKING',
    reading_sky: 'reading the sky over your location',

    pct_accurate: '% accurate',

    app_tagline: 'get outside. timing is everything.',
    fact_01:     'reads radar data updated every 5 minutes',
    fact_02:     'finds dry windows at your exact location',
    fact_03:     'tracks how accurate the forecast actually is',
    location_denied:        'location access denied.',
    location_not_supported: 'geolocation not supported by this browser',
    try_again:   'tap below to try again.',
    get_location:'GET MY LOCATION',
    locating:    'LOCATING',
    privacy:     'location stays in your browser. nothing is stored on our end.',
    made_with_love: 'For Salzburg, with love',

    info_title: 'About Gemma Raus',
    info_p1: 'Gemma Raus tells you exactly when to head outside at your GPS location. Rain, temperature and wind are all considered.',
    info_p2: 'The system reads 15-minute precipitation forecasts from Open-Meteo (ICON-EU model) and looks for dry windows of at least 30 minutes.',
    info_p3: 'Animated radar comes from RainViewer (European composite, ~40 minutes of history plus a short-term nowcast).',
    info_p4: 'As an independent measured source, the nearest GeoSphere Austria TAWES stations are queried for real 10-minute precipitation — actual observations, not a model. Salzburg Airport is always included.',
    info_p5: 'On top of that, the GeoSphere INCA analysis (radar+station blended, 1 km grid) gives precipitation right at your location, catching rain before the forecast model sees it.',
    info_p6: 'Accuracy is tracked automatically, predictions are stored and later checked against actual readings.',
    data_sources: 'Data sources',
    src_forecast: 'Forecast',
    src_radar:    'Radar',
    src_station:  'Stations',
    src_radar_pt: 'Radar point',
    src_accuracy: 'Accuracy',
    outside_sbz: 'You are outside Salzburg, radar map may show the wrong region',

    notify_on:          '◉',
    notify_off:         '◎',
    notify_denied:      'blocked',
    notify_unsupported: 'no push',

    install_title:  'Install app',
    install_brave:  'Brave or Samsung Browser: menu (⋮) then "Add to home screen"',
    install_safari: 'Safari on iOS: tap the share icon then "Add to Home Screen"',
    install_note:   'Once installed the app opens without an address bar like a native app.',

    privacy_title: 'Privacy',
    privacy_1: 'Your GPS coordinates leave your browser only as a direct request to Open-Meteo (Switzerland FADP-compliant). We never receive or store your location.',
    privacy_2: 'Only theme and language preferences are saved locally in your browser. No tracking cookies no account.',
    privacy_3: 'For push notifications we store an anonymous browser token with no location attached. Unsubscribe at any time.',
    privacy_basis: 'Legal basis: legitimate interest (Art. 6(1)(f) GDPR) for weather lookup; consent for push notifications.',

    close: 'CLOSE',

    guide_title:      'what does it all mean',
    guide_what_is:    '"gemma raus" is austrian dialect for "let us go outside!" one phrase that says everything.',
    guide_green:      'dry right now. just go.',
    guide_yellow:     'raining now. but a dry window is coming soon. the app shows how long you need to wait.',
    guide_red:        'no dry window in the next 3 hours. staying in today is totally fine.',
    guide_weather:    'below the main status you get notes on temperature, wind or snow. always based on your location.',
    guide_ex_wait:    'WAIT 12 MIN',
    guide_ex_stuck:   'STUCK INSIDE',
    guide_disclaimer: 'Forecasts from Open-Meteo (ICON-EU model), radar from DWD. Both are open source and free. Alpine radar can be imprecise and forecasts are not a guarantee. When in doubt look out the window.',

    weather_perfect:   'perfect out there. no excuse to stay in.',
    weather_hot:       '{temp}°C outside. shades and sunscreen first.',
    weather_scorching: 'hot! {temp}°C. sunscreen water then go.',
    weather_cold:      '{temp}°C outside. grab a jacket.',
    weather_freezing:  'only {temp}°C but fresh air is worth it.',
    weather_windy:     '{wind} km/h winds. hair chaos guaranteed. worth it.',
    weather_storm:     'storm! {wind} km/h. netflix is allowed today.',
    weather_snow:      'it is snowing! warm boots on and go anyway.',
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
