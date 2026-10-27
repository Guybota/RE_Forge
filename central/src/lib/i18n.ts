// Integration UI strings. The shared RE:Forge frame announces its selected engine language.
const en = {
  opening: "Opening the table…",
  engineFailed: "The table did not start.",
  frameFailed: "The table did not load.",
  deckMissing: "This deck is no longer in your library.",
  libraryFailed: "Your deck library could not be read.",
  retry: "Try again",
};
const pt: typeof en = {
  opening: "A abrir a mesa…",
  engineFailed: "Não foi possível iniciar a mesa.",
  frameFailed: "Não foi possível carregar a mesa.",
  deckMissing: "Este deck já não está na tua biblioteca.",
  libraryFailed: "Não foi possível ler a tua biblioteca de decks.",
  retry: "Tentar novamente",
};
export type PlayMessageKey = keyof typeof en;
export function playTranslator(language: string) {
  const messages = language.toLowerCase().startsWith("pt") ? pt : en;
  return (key: PlayMessageKey) => messages[key];
}

