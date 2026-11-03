/**
 * Grammar test set for the `fix` action: one known error per sentence, plus correct sentences
 * that must come back unchanged. `expect` items must all be in the output (an array lists
 * accepted alternatives); `forbid` items must be gone. Matching ignores case and apostrophe
 * style. Expected forms follow standard written French and English.
 */
export interface GrammarCase {
  id: string;
  language: "fr" | "en";
  category: string;
  text: string;
  expect: (string | string[])[];
  forbid?: string[];
}

const fr = (
  id: string,
  category: string,
  text: string,
  expect: GrammarCase["expect"],
  forbid: string[] = [],
): GrammarCase => ({ id: `fr-${id}`, language: "fr", category, text, expect, forbid });
const en = (
  id: string,
  category: string,
  text: string,
  expect: GrammarCase["expect"],
  forbid: string[] = [],
): GrammarCase => ({ id: `en-${id}`, language: "en", category, text, expect, forbid });
/** A correct sentence: must come back exactly as it is. */
const clean = (language: "fr" | "en", id: string, text: string): GrammarCase => ({
  id: `${language}-clean-${id}`,
  language,
  category: "correct",
  text,
  expect: [],
});

export const GRAMMAR_CORPUS: GrammarCase[] = [
  // French: conjugation
  fr("tu-viens", "conjugaison", "Tu vien demain ?", ["viens"]),
  fr("subj-venir", "subjonctif", "Il faut que tu vien demain.", ["viennes"], ["tu viens"]),
  fr("subj-faire", "subjonctif", "Il faut que tu fais attention.", ["fasses"]),
  fr("pouvoir", "conjugaison", "Je peut venir ce soir.", ["peux"]),
  fr("aller-il", "conjugaison", "Il vas au travail en bus.", ["il va "]),
  fr("aller-nous", "conjugaison", "Nous allont au cinéma samedi.", ["allons"]),
  fr("jouer-pl", "accord sujet-verbe", "Les enfants joue dans le jardin.", ["jouent"]),
  fr("faire-vous", "conjugaison", "Vous faite trop de bruit.", ["faites"]),
  fr("manger-ils", "accord sujet-verbe", "Ils mange à midi.", ["mangent"]),
  fr("croire", "conjugaison", "Je croit que tu as raison.", ["crois"]),
  fr("etre-pl", "accord sujet-verbe", "Mes amis est arrivés hier.", ["sont arrivés"]),
  // French: past participle and infinitive
  fr("pp-aller", "participe passé", "Je suis aller au marché.", ["allé"], ["aller au"]),
  fr("pp-manger", "participe passé", "J'ai manger une pomme.", ["mangé"]),
  fr("pp-prendre", "participe passé", "Elle a prit le train de huit heures.", ["pris"]),
  fr("pp-finir", "participe passé", "Il a finit son travail.", ["fini "]),
  fr("pp-partir", "participe passé", "Il est partit sans dire au revoir.", ["parti "]),
  fr("pp-parler", "participe passé", "C'est la fille dont je t'ai parler.", ["parlé"]),
  fr("inf-aller", "infinitif", "Je vais mangé avec eux.", ["vais manger"]),
  fr("inf-falloir", "infinitif", "Il faut mangé avant de partir.", ["faut manger"]),
  fr("accord-etre", "accord participe", "Elle est venu hier soir.", ["venue"]),
  fr("accord-etre-pl", "accord participe", "Mes sœurs sont arrivé en retard.", ["arrivées"]),
  fr("accord-cod", "accord participe", "Les pommes que j'ai mangé étaient bonnes.", ["mangées"]),
  fr("accord-pronominal", "accord participe", "Elles se sont parlées hier.", ["parlé "]),
  // French: tenses and moods
  fr("si-conditionnel", "concordance", "Si j'aurais su, je serais venu.", ["si j'avais su"]),
  fr("futur", "concordance", "Demain, je serais là à neuf heures.", ["serai "]),
  fr("passe-hier", "concordance", "Hier, je mange au restaurant avec Paul.", [
    ["j'ai mangé", "je mangeais"],
  ]),
  fr("malgre-que", "subjonctif", "Malgré qu'il pleuve, nous sortons.", ["bien qu'il pleuve"]),
  // French: agreement of nouns and adjectives
  fr("adj-fem", "accord adjectif", "Ils habitent dans une maison blanc.", ["maison blanche"]),
  fr("adj-pl", "accord adjectif", "Des voitures rapide passent devant chez moi.", ["rapides"]),
  fr("adj-gentil", "accord adjectif", "Ces filles sont très gentil.", ["gentilles"]),
  fr("adj-pp", "accord adjectif", "Ils ont été très gentil avec nous.", ["gentils"]),
  fr("pluriel-al", "pluriel", "Les animal du zoo sont calmes.", ["animaux"]),
  fr("tous", "accord", "Tout les jours, je cours.", ["tous les jours"]),
  fr("beaucoup-de", "pluriel", "Il y a beaucoup de problème.", ["problèmes"]),
  fr("quelle", "accord", "Quels belle journée !", ["quelle belle"]),
  fr("leur-sing", "accord", "Leurs maison est grande.", ["leur maison"]),
  fr("leur-pronom", "accord", "Je leurs ai dit la vérité.", ["leur ai"]),
  // French: homophones
  fr("a-accent", "homophones", "Il a mal a la tête.", ["à la tête"]),
  fr("est-et", "homophones", "Elle et partie à Paris.", ["est partie"]),
  fr("ou-accent", "homophones", "Ou est mon téléphone ?", ["où est"]),
  fr("ces-cest", "homophones", "C'est livres sont à moi.", ["ces livres"]),
  fr("sont-son", "homophones", "Ils son très contents.", ["sont très"]),
  fr("ont-on", "homophones", "Ils on fini leur travail.", ["ont fini"]),
  fr("peut-peu", "homophones", "Je pense qu'il peu venir.", ["peut venir"]),
  fr("ca-sa", "homophones", "Sa va bien ?", ["ça va"]),
  fr("se-ce", "homophones", "Il ce lève tôt.", ["se lève"]),
  fr("sest-cest", "homophones", "Il c'est trompé de route.", ["s'est trompé"]),
  fr("quant", "homophones", "Quand à moi, je reste ici.", ["quant à"]),
  fr("quelle-quelle", "homophones", "Je ne sais pas qu'elle heure il est.", ["quelle heure"]),
  fr("la-bas", "homophones", "Mets le livre la-bas.", ["là-bas"]),
  fr("sur-sur", "homophones", "Je suis sur que tu vas réussir.", ["sûr"]),
  fr("on-na", "négation", "On a pas le temps.", ["on n'a pas"]),
  // French: word order and sentence structure
  fr("ou-est-il", "ordre des mots", "Je ne sais pas où est-il.", ["où il est"]),
  fr("elision", "élision", "Je ai faim.", ["j'ai faim"]),
  fr("quest-ce", "ordre des mots", "Je me demande qu'est-ce qu'il veut.", ["ce qu'il veut"]),
  fr("tres-grande", "ordre des mots", "C'est une grande très maison.", ["très grande maison"]),
  fr("bien-tres", "ordre des mots", "Elle chante bien très.", ["très bien"]),
  fr(
    "verbe-fin",
    "ordre des mots",
    "Je vais demain au cinéma aller.",
    [["aller au cinéma", "aller demain au cinéma"]],
    ["cinéma aller"],
  ),
  fr("point-la", "trait d'union", "Je suis d'accord avec toi sur ce point là.", ["point-là"]),

  // English: verbs
  en("goes", "subject-verb", "He go to school every day.", ["goes"]),
  en("were", "subject-verb", "They was happy to see us.", ["were"]),
  en("doesnt", "subject-verb", "She don't like coffee.", [["doesn't", "does not"]]),
  en("doesnt-have", "subject-verb", "He don't have time.", [["doesn't", "does not"]]),
  en("we-were", "subject-verb", "We was going to call you.", ["we were"]),
  en("has-each", "subject-verb", "Each of the students have a book.", ["has a book"]),
  en("has-everyone", "subject-verb", "Everyone have their own opinion.", ["has"]),
  en("past-yesterday", "tense", "Yesterday I go to the market.", ["went"]),
  en("have-went", "tense", "I have went there twice.", [["have been", "have gone"]]),
  en("seen", "tense", "I seen him yesterday.", ["saw"]),
  en("bought", "irregular verb", "He buyed a new car.", ["bought"]),
  en("wrote", "irregular verb", "She writed a long letter.", ["wrote"]),
  en("ran", "irregular verb", "I runned to the bus.", ["ran"]),
  en("did-see", "verb form", "Did you saw the game?", ["did you see"]),
  en("didnt-go", "verb form", "I didn't went there.", ["didn't go"]),
  en("does-know", "verb form", "Does she knows the answer?", ["does she know"]),
  en("can-sing", "verb form", "He can sings very well.", ["can sing"]),
  en("agree", "verb form", "I am agree with you.", ["i agree"], ["am agree"]),
  en("is-going", "verb form", "She going to the gym now.", [["she is going", "she's going"]]),
  en("had-known", "tense", "If I would have known, I would have come.", ["if i had known"]),
  en("since", "tense", "I am living here since 2010.", [
    ["have been living", "have lived", "'ve lived", "'ve been living"],
  ]),
  en("went-last-year", "tense", "I have been to Paris last year.", ["went to paris"]),
  en("hearing", "verb form", "I look forward to hear from you.", ["to hearing"]),
  en("could-have", "verb form", "I could of called you.", ["could have"]),
  en("should-have", "verb form", "You should of told me.", ["should have"]),
  // English: nouns, articles, comparatives, pronouns
  en("an-apple", "article", "I has a apple.", ["i have an apple"]),
  en("an-honest", "article", "She is a honest person.", ["an honest"]),
  en("a-university", "article", "He is an university student.", ["a university"]),
  en("children", "plural", "I have two child.", ["children"]),
  en("childs", "plural", "The childs are playing outside.", ["children"]),
  en("information", "uncountable", "I need some informations.", ["information"], ["informations"]),
  en("issues", "plural", "There is a lot of issue.", ["issues"]),
  en("there-are", "subject-verb", "There is many people here.", ["there are"]),
  en("better", "comparative", "This is more better than that.", ["better"], ["more better"]),
  en(
    "smartest",
    "comparative",
    "She is the most smartest girl in class.",
    ["smartest"],
    ["most smartest"],
  ),
  en(
    "he-and-i",
    "pronoun",
    "Me and him went to the store.",
    [["he and i", "him and me"]],
    ["me and him went"],
  ),
  en("you-and-me", "pronoun", "Between you and I, it was a mistake.", ["between you and me"]),
  // English: confused words
  en("theyre", "confused words", "Their going to be late.", [["they're", "they are"]]),
  en("youre", "confused words", "Your welcome.", ["you're welcome"]),
  en("its", "confused words", "The dog wagged it's tail.", ["its tail"]),
  en("its-raining", "confused words", "Its raining again.", [["it's raining", "it is raining"]]),
  en("than", "confused words", "She is taller then me.", ["than"]),
  en("too", "confused words", "I want to go to.", ["go too"]),
  en("lose", "confused words", "Don't loose your keys.", ["lose"]),
  en("affect", "confused words", "The weather will effect our plans.", ["affect"]),
  en("whose", "confused words", "Who's book is this?", ["whose book"]),
  en("a-lot", "spelling", "Alot of people came.", ["a lot"]),
  en("received", "spelling", "I recieved your email.", ["received"]),
  en("lend", "word choice", "Could you borrow me your pen?", ["lend me"]),
  en("said", "word choice", "He told that he was tired.", [
    ["said that", "told me that", "told us that"],
  ]),
  // English: prepositions and structure
  en("depends-on", "preposition", "It depends of the weather.", ["depends on"]),
  en("married-to", "preposition", "She is married with a doctor.", ["married to"]),
  en("interested-in", "preposition", "I am interested about music.", ["interested in"]),
  en("discuss", "preposition", "Let's discuss about it.", ["discuss it"]),
  en("explained", "structure", "She explained me the problem.", ["explained the problem to me"]),
  en(
    "double-negative",
    "negation",
    "I don't have no money.",
    [["don't have any", "have no money"]],
    ["don't have no"],
  ),
  en("hardly", "negation", "She can't hardly wait.", ["can hardly"]),
  // English: word order
  en("question", "word order", "What you are doing?", ["what are you doing"]),
  en("indirect-question", "word order", "I don't know where is he.", ["where he is"]),
  en("adverb", "word order", "She goes always to school by bus.", ["always goes"]),
  en(
    "time-adverb",
    "word order",
    "I yesterday went to the cinema.",
    [["yesterday i went", "yesterday, i went", "cinema yesterday"]],
    ["i yesterday went"],
  ),
  en("adjective-order", "word order", "He has a red big car.", ["big red car"]),

  // Correct sentences: nothing may change.
  clean("fr", "gare", "Je te retrouve à la gare demain à 9 h."),
  clean("fr", "build", "Les résultats du build sont disponibles sur GitHub."),
  clean("fr", "message", "Merci pour ton message, je te réponds ce soir."),
  clean("fr", "rendu", "Elle s'est rendu compte de son erreur."),
  clean("fr", "vus", "Nous nous sommes vus hier."),
  clean("fr", "viennes", "Il faut que tu viennes demain."),
  clean("fr", "pdf", "Est-ce que tu as reçu le fichier PDF ?"),
  clean("fr", "karim", "Salut Karim, on se voit vendredi ?"),
  clean("fr", "rapport", "Je n'ai pas encore lu ton rapport."),
  clean("fr", "permis", "Je me suis permis de vous écrire."),
  clean("en", "report", "I think the report is ready."),
  clean("en", "station", "Let's meet at the station at 9."),
  clean("en", "build", "The build passed on GitHub Actions."),
  clean("en", "message", "Thanks for your message, I'll reply tonight."),
  clean("en", "since", "She has lived here since 2010."),
  clean("en", "pdf", "Could you send me the PDF by Friday?"),
  clean("en", "sam", "Hey Sam, are we still on for lunch?"),
  clean("en", "neither", "Neither option is perfect, but the second one is cheaper."),
  clean("en", "rather", "I'd rather stay home tonight."),
  clean("en", "npm", "Run npm install, then open localhost:5173 in Chrome."),
];
