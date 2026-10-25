/** PIVNIK manually dictated drink list, NOT Evotor product IDs or live stock. */
export type BeerCatalogItem = { id:string; name:string; aliases:readonly string[]; countedAt:string|null; balance:string|null }
export const BEER_CATALOG:readonly BeerCatalogItem[] = [
  {id:"beer-01",name:"Хадыженское",aliases:["Хадыга","Хадыженская"],countedAt:"2026-10-25",balance:"¼ кеги (~12,5 л)"},
  {id:"beer-02",name:"Венский лагер",aliases:["Венский","Венецкий"],countedAt:"2026-10-25",balance:"2 кеги"},
  {id:"beer-03",name:"Шумерское",aliases:["Шумерская"],countedAt:"2026-10-25",balance:"почти полная кега"},
  {id:"beer-04",name:"Ирландский эль",aliases:["Ирландский Эль"],countedAt:"2026-10-25",balance:"2 кеги"},
  {id:"beer-05",name:"Холстен",aliases:["Хольстон","Холстен (СССР)"],countedAt:"2026-10-25",balance:"2 кеги"},
  {id:"beer-06",name:"Вишня",aliases:["Вишнёвая"],countedAt:"2026-10-25",balance:"⅔ кеги"},
  {id:"beer-07",name:"Шпатен",aliases:["Шпатон"],countedAt:"2026-10-25",balance:"полная кега"},
  {id:"beer-08",name:"Дарк эль",aliases:["Дарк Эль"],countedAt:"2026-10-25",balance:"чуть больше ⅔ кеги"},
  {id:"beer-09",name:"Сидр Роял",aliases:["Сидр роял"],countedAt:"2026-10-25",balance:"чуть больше ⅔ кеги"},
  {id:"beer-10",name:"Чешский лежак",aliases:["Лежак"],countedAt:"2026-10-25",balance:"3 кеги"},
  {id:"beer-11",name:"Вайзенбок",aliases:["Вайзенбок"],countedAt:"2026-10-25",balance:"⅓ кеги"},
  {id:"beer-12",name:"Оранж Киллер",aliases:["Киллер"],countedAt:"2026-10-25",balance:"почти полная кега"},
  {id:"beer-13",name:"Милк стаут",aliases:[],countedAt:"2026-10-25",balance:"½ кеги"},
  {id:"beer-14",name:"Жюль Верн",aliases:[],countedAt:"2026-10-25",balance:"почти полная кега"},
  {id:"beer-15",name:"Малина-гранат",aliases:["Малина гранат"],countedAt:"2026-10-25",balance:"⅕ кеги, запасных нет"},
  {id:"beer-16",name:"Шрёддер",aliases:["Шрёдер"],countedAt:"2026-10-25",balance:"чуть меньше ½ кеги"},
  {id:"beer-17",name:"Премиум пшено",aliases:["Пшено"],countedAt:"2026-10-25",balance:"2 полные кеги"},
  {id:"beer-18",name:"Имперский портер",aliases:["Империал портер","Портер"],countedAt:"2026-10-25",balance:"почти полная кега"},
  {id:"beer-19",name:"Дебошир",aliases:[],countedAt:"2026-10-25",balance:"⅕ кеги"},
  {id:"beer-20",name:"Шварцбир",aliases:["Шварц"],countedAt:"2026-10-25",balance:"почти закончилась"},
  {id:"beer-21",name:"Оранж бланш",aliases:[],countedAt:"2026-10-25",balance:"полная кега"},
  {id:"beer-22",name:"Жигулёвское",aliases:["Жига","Жигули"],countedAt:"2026-10-25",balance:"полная кега"},
  {id:"beer-23",name:"Чешское барное",aliases:["Барное","Чешская барная"],countedAt:"2026-10-25",balance:"2 полные кеги"},
  {id:"beer-24",name:"Хефевайзен",aliases:["Хефивайзен"],countedAt:"2026-10-25",balance:"⅓ кеги"},
  {id:"beer-25",name:"Пилснер",aliases:[],countedAt:"2026-10-25",balance:"3 кеги"},
  {id:"beer-26",name:"Клубника гозе",aliases:["Клубника Гозе"],countedAt:"2026-10-25",balance:"нет"},
  {id:"beer-27",name:"Медовуха",aliases:[],countedAt:"2026-10-25",balance:"⅓ кеги"},
  {id:"beer-28",name:"Эльдорадо",aliases:["Эль эльдорадо"],countedAt:"2026-10-25",balance:"остаток не указан"},
  {id:"beer-29",name:"Квантум черри",aliases:["Квантум"],countedAt:null,balance:null},
  {id:"beer-30",name:"Черника стаут",aliases:["Черничный стаут"],countedAt:null,balance:null},
  {id:"beer-31",name:"Вишня Крэк",aliases:[],countedAt:null,balance:null},
  {id:"beer-32",name:"ИПА",aliases:["IPA","Ипа"],countedAt:null,balance:null},
  {id:"beer-33",name:"Зеро",aliases:["Zero"],countedAt:null,balance:null},
  {id:"beer-34",name:"Томатное гозе",aliases:[],countedAt:null,balance:null},
  {id:"beer-35",name:"Трипель",aliases:[],countedAt:null,balance:null},
];
export const beerSearchKey = (name:string) => name.toLocaleLowerCase("ru-RU").normalize("NFKC").replace(/ё/gu,"е").replace(/[^\p{L}\p{N}]+/gu," ").trim()
export function filterBeerCatalog(query:string){
  const needle=beerSearchKey(query)
  if(!needle)return BEER_CATALOG
  return BEER_CATALOG.filter(item=>[item.name,...item.aliases].some(value=>beerSearchKey(value).includes(needle)))
}
export function parsePositiveLiters(raw:string):number|null {
  if(!/^\d+(?:[.,]\d{1,3})?$/.test(raw.trim()))return null
  const n=Number(raw.replace(",","."))
  return Number.isFinite(n)&&n>=0.001&&n<=10000 ? n : null
}
