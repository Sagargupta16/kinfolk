/**
 * Name pools for the sample tree, grouped by naming tradition.
 *
 * Grouped rather than one flat list because a family shares a surname AND
 * usually a naming tradition: pairing a Nordic surname with a Tamil given name
 * produces people who read as generated, which undermines a demo whose job is to
 * look like real records. Generation is per-household, so each family draws from
 * one bucket.
 *
 * Sourced from randomuser.me's locale pools (a public API of synthetic
 * identities), sampled with a fixed seed and then thinned by even stride so the
 * spread runs across the alphabet instead of clustering on A. Latin-script
 * buckets only, since the canvas has one font stack.
 *
 * These are synthetic names, not real people's. Nothing here is anybody's data.
 */

export type Culture =
	| "anglo"
	| "west_europe"
	| "nordic"
	| "latin"
	| "east_europe"
	| "south_asia"
	| "west_asia";

type NamePool = {
	female: string[];
	male: string[];
	family: string[];
};

/**
 * Pools are written as one delimited string, not an array literal.
 *
 * A formatter that gives each array element its own line turns 450 names into 450
 * lines, and a pool that has to be scrolled is harder to audit than one that fits
 * on screen. Template literals are left alone, so this stays compact whatever the
 * print width is.
 *
 * The delimiter is `|` rather than a space or a comma because several names
 * legitimately contain a space ("Van der Vegte", "María Luisa").
 */
function list(pool: string): string[] {
	return pool
		.split("|")
		.map((name) => name.trim())
		.filter(Boolean);
}

export const NAMES: Record<Culture, NamePool> = {
	anglo: {
		female: list(`Abigail|Alexis|Andrea|April|Ariane|Avery|Bessie|Britney|Caroline|Clara|Delores|
			Emilie|Eva|Florence|Glenda|Heidi|Isabella|Jeanette|Julia|Kathy|Kelly|Lea|Lillian|Lorraine|
			Maria|Mattie|Michele|Paula|Rita|Shannon|Sofia|Sophie|Suzanne|Victoria`),
		male: list(`Aaron|Alex|Alfredo|Arlo|Barry|Caleb|Charlie|Cooper|Danny|Dustin|Edward|Felix|
			Gabriel|Harry|Hudson|Jack|Jaxon|Jeffery|Joey|Justin|Lee|Lincoln|Lucas|Max|Nelson|Oliver|
			Philippe|Reginald|Rodney|Russell|Terry|Tommy|Tristan|William`),
		family: list(`Abraham|Banks|Boyd|Bélanger|Clarke|Davidson|Evans|Fortin|Garrett|Griffin|Hawkins|
			Hudson|Jones|Lam|Lo|Mckinney|Morgan|Nichols|Payne|Powell|Robertson|Sanchez|Smith|Thompson|
			Walters|Wheeler`),
	},
	west_europe: {
		female: list(`Adelinde|Amelia|Anastasia|Annemarie|Barbara|Camilla|Cathalijne|Corinna|Dina|
			Emelie|Gabriela|Hafize|Helga|Irina|Jordan|Kreszentia|Liliane|Liselotte|Léa|Margaux|Marwa|
			Natascha|Océane|Rose|Sophie|Valéry`),
		male: list(`Aaron|Alexandre|Attila|Baptist|Charaf|Danny|Diego|Dominic|Ensar|Figo|Gianni|Günter|
			Ingmar|Jordan|Justin|Lenny|Loris|Martin|Mijo|Naim|Nouaman|Rainier|Robel|Sabri|Stefanos|
			Wenzel`),
		family: list(`Akin|Bertrand|Brun|Da Silva|Dupont|Fleury|Giraud|Höhne|Klippel|Laman|Lichtenberg|
			Messer|Olivier|Quak|Rolland|Schmitt|Sluimer|Van Brunschot|Van der Vegte|Vugts`),
	},
	nordic: {
		female: list(`Aada|Alina|Anny|Eevi|Elli|Emina|Filippa|Gunhild|Isla|Julie|Kerttu|Liepa|Lumi|
			Maja|Nanna|Rosa|Sarah|Silja|Tilde|Veera`),
		male: list(`Abdirahman|Alexander|Anton|Christian|Daniel|Emil|Fillip|Halvor|Imran|Lenni|Mads|
			Mikael|Niklas|Oliver|Peetu|Richard|Samuel|Sofus|Valdemar|Viljami`),
		family: list(`Aasbø|Braathen|Erkkila|Hannula|Huotari|Kihle|Kvam|Lein|Løvli|Moilanen|Niska|
			Perko|Remes|Silseth|Sørensen|Ullestad`),
	},
	latin: {
		female: list(`Aida|Anice|Camila|Celia|Claudeci|Diana|Eleutéria|Elvira|Etelvira|Gema|Ilma|
			Josefina|Keli|Lidia|Luz|María Luisa|Milagros|Neivana|Quênia|Romana|Silvia|Ximena`),
		male: list(`Adalberto|Albert|Almiro|Andrés|Azuma|Carlos|Cristiano|Dilan|Fernando|German|
			Heraldo|Jessé|Juan|Lindoro|Moisés|Olivar|Ramses|Rodolfo|Salazar|Tibério|Valentin|Wilfrido`),
		family: list(`Aguilar|Barbosa|Cabán|Carrasco|Dias|Ferrer|Gil|Herrera|Lima|Melgar|Mota|Olivares|
			Porto|Rocha|Santos|Tejada|Viana|da Mata`),
	},
	east_europe: {
		female: list(`Alla|Anka|Boguslava|Dariya|Ester|Haritya|Jadranka|Lina|Lukiya|Milica|Mina|Orina|
			Predslava|Rianna|Stella|Svitoslava|Vera|Vojislava`),
		male: list(`Aćim|Bryachislav|Davor|Dobroslav|Jakov|Krsto|Matija|Mladen|Prvoslav|Radovan|Saša|
			Simeon|Slavomir|Teodosije|Velibor|Viroslav|Yasnozir|Zvonimir`),
		family: list(`Aleksiievec|Branković|Galushchinskiy|Ivanić|Katić|Kuzminskiy|Malešević|
			Onofriychuk|Popadyuk|Silchenko|Spasojević|Topić|Vilgushinskiy|Zolotnickiy`),
	},
	south_asia: {
		female: list(`Adhira|Akhila|Arpitha|Gayathri|Hetal|Ira|Lavanya|Manisha|Namratha|Reshma|Shruti|
			Sonika|Sushma|Tanvi`),
		male: list(`Abhinav|Balendra|Balvan|Chatura|Dwarakanath|Gautam|Girish|Lohit|Neel|Parv|Rushil|
			Samesh|Teerth|Udarsh`),
		family: list(`Acharya|Bangera|Chavare|Dhamdhame|Holla|Kini|Moolya|Padmanabha|Prajapati|Saha|
			Shenoy|Suvarna`),
	},
	west_asia: {
		female: list(`Afşar|Ayşe|Buse|Gonca|Gül|Melike|Nurdan|Oya|Vildan|Ömür`),
		male: list(`Ahmet|Ceyhun|Davut|Ege|Esat|Kaya|Kerim|Mehmet|Necati|Vedat`),
		family: list(`Abadan|Akaydın|Barbarosoğlu|Durmaz|Erdoğan|Fahri|Kunter|Sepetçi|Taşçı|Çörekçi`),
	},
};

export const CULTURES = Object.keys(NAMES) as Culture[];
