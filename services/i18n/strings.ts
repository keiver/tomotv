/**
 * The app's user-visible strings, English first.
 *
 * English is the shape: every other catalogue is `Partial<Strings>` and a key it
 * does not carry falls back rather than rendering a key name at a viewer. Adding
 * a string means adding it here and nowhere else, since the type is derived.
 *
 * Vocabulary comes from applestore/l10n-glossary.json, which is Jellyfin's own
 * translations for the product nouns and Apple's for the platform ones, so the
 * app and the store listing say the same words.
 */
export const en = {
  "tab.home": "Home",
  "tab.library": "Library",
  "tab.search": "Search",
  "tab.downloads": "Downloads",
  "tab.settings": "Settings",

  "filters.title": "Filters",
  "filters.clearAll": "Clear All",
  "filters.clearAllHint": "Clear all filters",
  "filters.close": "Close filters",
  "filters.status": "Status",
  "filters.favorite": "Favorite",
  "filters.played": "Played",
  "filters.unplayed": "Unplayed",
  "filters.sort": "Sort",
  "filters.shuffle": "Shuffle",
  "filters.genres": "Genres",
  "filters.artists": "Artists",
  "filters.years": "Years",
  "filters.loading": "Loading filter options",

  "search.placeholder": "Search your library",
  "search.empty": "Nothing matched that search",
  "search.disconnected": "Connect to a server to search",

  "downloads.title": "Downloads",
  "downloads.empty": "Nothing downloaded yet",
  "downloads.storage": "Storage",

  "quality.title": "Quality",
  "quality.auto": "Auto",
  "quality.original": "Original",

  "connect.title": "Connect to Jellyfin",
  "connect.serverAddress": "Server address",
  "connect.username": "Username",
  "connect.password": "Password",
  "connect.signIn": "Sign In",
  "connect.demo": "Try the demo server",
  "connect.scanning": "Looking for servers on this network",
} as const;

export type StringKey = keyof typeof en;
export type Catalogue = Partial<Record<StringKey, string>>;

export const de: Catalogue = {
  "tab.home": "Start",
  "tab.library": "Bibliothek",
  "tab.search": "Suche",
  "tab.downloads": "Downloads",
  "tab.settings": "Einstellungen",

  "filters.title": "Filter",
  "filters.clearAll": "Alle löschen",
  "filters.clearAllHint": "Alle Filter löschen",
  "filters.close": "Filter schließen",
  "filters.status": "Status",
  "filters.favorite": "Favorit",
  "filters.played": "Gesehen",
  "filters.unplayed": "Ungesehen",
  "filters.sort": "Sortierung",
  "filters.shuffle": "Zufall",
  "filters.genres": "Genres",
  "filters.artists": "Künstler",
  "filters.years": "Jahre",
  "filters.loading": "Filteroptionen werden geladen",

  "search.placeholder": "Bibliothek durchsuchen",
  "search.empty": "Nichts gefunden",
  "search.disconnected": "Verbinde dich mit einem Server, um zu suchen",

  "downloads.title": "Downloads",
  "downloads.empty": "Noch nichts heruntergeladen",
  "downloads.storage": "Speicher",

  "quality.title": "Qualität",
  "quality.auto": "Auto",
  "quality.original": "Original",

  "connect.title": "Mit Jellyfin verbinden",
  "connect.serverAddress": "Serveradresse",
  "connect.username": "Benutzername",
  "connect.password": "Passwort",
  "connect.signIn": "Anmelden",
  "connect.demo": "Demo-Server ausprobieren",
  "connect.scanning": "Suche nach Servern in diesem Netzwerk",
};

export const fr: Catalogue = {
  "tab.home": "Accueil",
  "tab.library": "Médiathèque",
  "tab.search": "Recherche",
  "tab.downloads": "Téléchargements",
  "tab.settings": "Réglages",

  "filters.title": "Filtres",
  "filters.clearAll": "Tout effacer",
  "filters.clearAllHint": "Effacer tous les filtres",
  "filters.close": "Fermer les filtres",
  "filters.status": "Statut",
  "filters.favorite": "Favori",
  "filters.played": "Lu",
  "filters.unplayed": "Non lu",
  "filters.sort": "Tri",
  "filters.shuffle": "Aléatoire",
  "filters.genres": "Genres",
  "filters.artists": "Artistes",
  "filters.years": "Années",
  "filters.loading": "Chargement des filtres",

  "search.placeholder": "Rechercher dans la médiathèque",
  "search.empty": "Aucun résultat",
  "search.disconnected": "Connecte-toi à un serveur pour rechercher",

  "downloads.title": "Téléchargements",
  "downloads.empty": "Rien de téléchargé pour l'instant",
  "downloads.storage": "Stockage",

  "quality.title": "Qualité",
  "quality.auto": "Auto",
  "quality.original": "Original",

  "connect.title": "Se connecter à Jellyfin",
  "connect.serverAddress": "Adresse du serveur",
  "connect.username": "Nom d'utilisateur",
  "connect.password": "Mot de passe",
  "connect.signIn": "Se connecter",
  "connect.demo": "Essayer le serveur de démo",
  "connect.scanning": "Recherche de serveurs sur ce réseau",
};

export const es: Catalogue = {
  "tab.home": "Inicio",
  "tab.library": "Biblioteca",
  "tab.search": "Buscar",
  "tab.downloads": "Descargas",
  "tab.settings": "Ajustes",

  "filters.title": "Filtros",
  "filters.clearAll": "Borrar todo",
  "filters.clearAllHint": "Borrar todos los filtros",
  "filters.close": "Cerrar filtros",
  "filters.status": "Estado",
  "filters.favorite": "Favorito",
  "filters.played": "Visto",
  "filters.unplayed": "No visto",
  "filters.sort": "Orden",
  "filters.shuffle": "Aleatorio",
  "filters.genres": "Géneros",
  "filters.artists": "Artistas",
  "filters.years": "Años",
  "filters.loading": "Cargando opciones de filtro",

  "search.placeholder": "Busca en tu biblioteca",
  "search.empty": "No hay resultados",
  "search.disconnected": "Conéctate a un servidor para buscar",

  "downloads.title": "Descargas",
  "downloads.empty": "Todavía no has descargado nada",
  "downloads.storage": "Almacenamiento",

  "quality.title": "Calidad",
  "quality.auto": "Auto",
  "quality.original": "Original",

  "connect.title": "Conectar con Jellyfin",
  "connect.serverAddress": "Dirección del servidor",
  "connect.username": "Usuario",
  "connect.password": "Contraseña",
  "connect.signIn": "Iniciar sesión",
  "connect.demo": "Probar el servidor de demostración",
  "connect.scanning": "Buscando servidores en esta red",
};

export const catalogues: Record<string, Catalogue> = { en, de, fr, es };
