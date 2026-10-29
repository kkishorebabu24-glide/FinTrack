/**
 * FinTrack - Configuration, Storage & Global State
 * Standard: ISO/IEC 25010 Modularity & Separation of Concerns
 */

// Google Drive & Gmail API Configuration
let CLIENT_ID = localStorage.getItem('ft_google_client_id') || 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
let API_KEY = localStorage.getItem('ft_google_api_key') || 'YOUR_GOOGLE_API_KEY';
const DRIVE_DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const GMAIL_DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest';
const DISCOVERY_DOCS = [DRIVE_DISCOVERY_DOC, GMAIL_DISCOVERY_DOC];
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.readonly';
const FILE_NAME = 'fintrack_backup.json';
const FOLDER_NAME = 'FinTrack';

// Auth State
let tokenClient = null;
let gapiInited = false;
let gisInited = false;
let isAuthenticated = false;

// Local Storage Helpers
function loadData(key, fallback) {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : fallback;
}

function saveData(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

// Default Categories
const DEFAULT_CATEGORIES = {
  expense: ['Bills', 'EMI', 'Entertainment', 'Food & Drinks', 'Fuel', 'Groceries', 'Health', 'Shopping', 'Travel', 'Other'],
  income: ['Salary', 'Freelance', 'Investment Income', 'Gift', 'Other'],
  transfer: ['Transfer', 'Investment']
};

// Default Indian Merchant Rules Dictionary (History Tagging Seed)
const DEFAULT_MERCHANT_RULES = {
  // Groceries
  "blinkit": "Groceries", "zepto": "Groceries", "instamart": "Groceries", "bigbasket": "Groceries",
  "bb daily": "Groceries", "dmart": "Groceries", "d-mart": "Groceries", "reliance smart": "Groceries",
  "reliance fresh": "Groceries", "reliance retail": "Groceries", "smart bazaar": "Groceries",
  "smart point": "Groceries", "ratnadeep": "Groceries", "supermarket": "Groceries", "jiomart": "Groceries",
  "nature's basket": "Groceries", "spencer": "Groceries", "more retail": "Groceries", "milkbasket": "Groceries",
  "country delight": "Groceries",
  // Food & Drinks
  "swiggy": "Food & Drinks", "zomato": "Food & Drinks", "mcdonald": "Food & Drinks", "starbucks": "Food & Drinks",
  "domino": "Food & Drinks", "kfc": "Food & Drinks", "burger king": "Food & Drinks", "pizza hut": "Food & Drinks",
  "subway": "Food & Drinks", "chai point": "Food & Drinks", "chaayos": "Food & Drinks", "cafe coffee day": "Food & Drinks",
  "haldiram": "Food & Drinks", "behrouz": "Food & Drinks", "faasos": "Food & Drinks", "eatfit": "Food & Drinks",
  // Shopping
  "amazon": "Shopping", "amzn": "Shopping", "flipkart": "Shopping", "myntra": "Shopping", "ajio": "Shopping",
  "meesho": "Shopping", "nykaa": "Shopping", "tata cliq": "Shopping", "zara": "Shopping", "h&m": "Shopping",
  "decathlon": "Shopping", "uniqlo": "Shopping", "croma": "Shopping", "reliance digital": "Shopping",
  "vijay sales": "Shopping", "ikea": "Shopping", "lenskart": "Shopping",
  // Fuel
  "hpcl": "Fuel", "bpcl": "Fuel", "iocl": "Fuel", "indian oil": "Fuel", "bharat petroleum": "Fuel",
  "hindustan petroleum": "Fuel", "shell": "Fuel", "petrol": "Fuel", "fuel": "Fuel", "cng": "Fuel",
  // Entertainment
  "netflix": "Entertainment", "spotify": "Entertainment", "bookmyshow": "Entertainment", "pvr": "Entertainment",
  "inox": "Entertainment", "prime video": "Entertainment", "hotstar": "Entertainment", "disney": "Entertainment",
  "youtube": "Entertainment", "sonyliv": "Entertainment", "zee5": "Entertainment", "apple.com": "Entertainment",
  "steam": "Entertainment", "playstation": "Entertainment",
  // Travel
  "uber": "Travel", "ola": "Travel", "rapido": "Travel", "irctc": "Travel", "makemytrip": "Travel",
  "goibibo": "Travel", "indigo": "Travel", "air india": "Travel", "redbus": "Travel", "abhibus": "Travel",
  "fastag": "Travel", "namma metro": "Travel", "dmrc": "Travel", "cleartrip": "Travel", "easemytrip": "Travel",
  // Bills & Utilities
  "bescom": "Bills", "cesc": "Bills", "tata power": "Bills", "adani electricity": "Bills", "msedcl": "Bills",
  "airtel": "Bills", "jio": "Bills", "vodafone": "Bills", "vi ": "Bills", "bsnl": "Bills", "act fibernet": "Bills",
  "tata play": "Bills", "dishtv": "Bills", "indane": "Bills", "hp gas": "Bills", "bharat gas": "Bills", "igl": "Bills",
  // EMI & Loans
  "cred": "EMI", "bajaj finance": "EMI", "home loan": "EMI", "car loan": "EMI", "auto loan": "EMI",
  "personal loan": "EMI", "axio": "EMI", "zestmoney": "EMI", "slice": "EMI", "hdfc bank loan": "EMI",
  // Health
  "apollo": "Health", "1mg": "Health", "pharmeasy": "Health", "medplus": "Health", "max healthcare": "Health",
  "fortis": "Health", "manipal": "Health", "dr lal": "Health", "thyrocare": "Health", "cultfit": "Health", "cult.fit": "Health",
  // Investment / Transfer
  "zerodha": "Investment", "groww": "Investment", "angelone": "Investment", "upstox": "Investment",
  "kuvera": "Investment", "indmoney": "Investment", "coin": "Investment", "cams": "Investment",
  "kfintech": "Investment", "mutual fund": "Investment", "ppf": "Investment", "nps": "Investment",
  // Income
  "salary": "Salary", "payroll": "Salary", "wage": "Salary", "stipend": "Salary", "interest": "Investment Income",
  "dividend": "Investment Income"
};

// Global Application State
let expenses = loadData('ft_expenses', []);
let incomeEntries = loadData('ft_income', []);
let chores = loadData('ft_chores', []);
let criteria = loadData('ft_criteria', [
  { id: 1, name: 'Emergency Fund (6 months expenses)', achieved: false },
  { id: 2, name: 'Health Insurance (family floater)', achieved: false },
  { id: 3, name: 'Term Life Insurance', achieved: false },
  { id: 4, name: 'PPF Account (Public Provident Fund)', achieved: false },
  { id: 5, name: 'NPS (National Pension System)', achieved: false },
  { id: 6, name: 'Sukanya Samriddhi Yojana (if applicable)', achieved: false },
  { id: 7, name: 'Atal Pension Yojana', achieved: false },
  { id: 8, name: 'Pradhan Mantri Jeevan Jyoti Bima Yojana', achieved: false },
  { id: 9, name: 'Pradhan Mantri Suraksha Bima Yojana', achieved: false },
  { id: 10, name: 'Fixed Deposit / Debt fund for short-term goals', achieved: false }
]);
let goals = loadData('ft_goals', []);
let categories = loadData('ft_categories', DEFAULT_CATEGORIES);
let merchantRules = loadData('ft_merchant_rules', DEFAULT_MERCHANT_RULES);
let creditProfile = loadData('ft_credit_profile', null);
let stagedTransactions = [];
let currentStatementTransactions = [];
let currentEmailAlertTransactions = [];
let stagedFilter = 'all';
let hideDuplicates = true;
let pendingPasswordCallback = null;

// Category Utilities
function getCategoryType(name) {
  if (categories.expense && categories.expense.includes(name)) return 'expense';
  if (categories.income && categories.income.includes(name)) return 'income';
  if (categories.transfer && categories.transfer.includes(name)) return 'transfer';
  return null;
}

function getAllCategoryNames() {
  return [
    ...(categories.expense || []),
    ...(categories.income || []),
    ...(categories.transfer || [])
  ];
}

// Date Normalizer (Supports DD/MM/YYYY, DD-MM-YYYY, DD MMM YYYY, DD/MM/YY, YYYY-MM-DD, 28Oct26)
function normalizeDate(str) {
  if (!str) return new Date().toISOString().slice(0, 10);
  str = String(str).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // DD/MM/YYYY or DD-MM-YYYY
  let m = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  // DD/MM/YY or DD-MM-YY
  m = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})$/);
  if (m) {
    const yr = parseInt(m[3]) > 50 ? '19' + m[3] : '20' + m[3];
    return `${yr}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  // DD-MMM-YYYY or DD MMM YYYY (e.g. 14 Oct 2026 or 14-Oct-26)
  const monthMap = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  m = str.match(/^(\d{1,2})[\s\-\.]([A-Za-z]{3})[\s\-\.](\d{2,4})$/);
  if (m) {
    const mo = monthMap[m[2].toLowerCase()] || '01';
    let yr = m[3];
    if (yr.length === 2) yr = parseInt(yr) > 50 ? '19' + yr : '20' + yr;
    return `${yr}-${mo}-${m[1].padStart(2, '0')}`;
  }
  // format: 28Oct26
  m = str.match(/^(\d{1,2})([A-Za-z]{3})(\d{2,4})$/);
  if (m) {
    const mo = monthMap[m[2].toLowerCase()] || '01';
    let yr = m[3];
    if (yr.length === 2) yr = parseInt(yr) > 50 ? '19' + yr : '20' + yr;
    return `${yr}-${mo}-${m[1].padStart(2, '0')}`;
  }
  const d = new Date(str);
  return !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

// Amount Parser
function parseAmount(val) {
  if (typeof val === 'number') return Math.abs(val);
  if (!val) return 0;
  let s = String(val).replace(/[₹\$,\s]/g, '').trim();
  s = s.replace(/\((.*?)\)/, '-$1');
  const parsed = parseFloat(s);
  return isNaN(parsed) ? 0 : Math.abs(parsed);
}
