// Must stay equal to data/seed.json (Apps Script cannot read files).
const SEED = {
  "categories": [
    {
      "id": "food",
      "group": "Living",
      "name": "Food",
      "type": "expense",
      "default_nature": "",
      "aliases": "makan, minum, kopi, jajan, lunch, dinner, breakfast, groceries, sembako",
      "active": true
    },
    {
      "id": "kpr-ipl",
      "group": "Living",
      "name": "KPR & IPL",
      "type": "expense",
      "default_nature": "need",
      "aliases": "kpr, ipl, cicilan rumah, mortgage",
      "active": true
    },
    {
      "id": "kuota-pulsa",
      "group": "Living",
      "name": "Kuota / Pulsa",
      "type": "expense",
      "default_nature": "need",
      "aliases": "kuota, pulsa, paket data, internet, wifi, token listrik",
      "active": true
    },
    {
      "id": "medicine",
      "group": "Living",
      "name": "Medicine",
      "type": "expense",
      "default_nature": "need",
      "aliases": "obat, apotek, dokter, vitamin, klinik",
      "active": true
    },
    {
      "id": "transport-ojol-bensin",
      "group": "Transport",
      "name": "Transport / ojol / bensin",
      "type": "expense",
      "default_nature": "need",
      "aliases": "gojek, grab, ojol, bensin, pertalite, pertamax, tol, krl, mrt, busway, taksi",
      "active": true
    },
    {
      "id": "motorbike-adv150",
      "group": "Transport",
      "name": "Motorbike - ADV150",
      "type": "expense",
      "default_nature": "need",
      "aliases": "adv, motor, servis motor, oli, ganti oli, pajak motor, bengkel",
      "active": true
    },
    {
      "id": "parking-pakogah",
      "group": "Transport",
      "name": "Parking / PakOgah",
      "type": "expense",
      "default_nature": "need",
      "aliases": "parkir, pakogah, parking",
      "active": true
    },
    {
      "id": "class-training-workshop",
      "group": "Growth",
      "name": "Class / Training / Workshop",
      "type": "expense",
      "default_nature": "need",
      "aliases": "kursus, kelas, course, udemy, workshop, training, buku",
      "active": true
    },
    {
      "id": "barber-selfcare",
      "group": "Personal",
      "name": "Barber / selfcare",
      "type": "expense",
      "default_nature": "",
      "aliases": "barber, potong rambut, cukur, skincare, spa, salon",
      "active": true
    },
    {
      "id": "game",
      "group": "Lifestyle",
      "name": "Game",
      "type": "expense",
      "default_nature": "want",
      "aliases": "game, steam, topup game, voucher game, playstation",
      "active": true
    },
    {
      "id": "sport",
      "group": "Lifestyle",
      "name": "Sport",
      "type": "expense",
      "default_nature": "",
      "aliases": "gym, futsal, badminton, olahraga, lari, sepatu olahraga",
      "active": true
    },
    {
      "id": "entertainment-party",
      "group": "Lifestyle",
      "name": "Entertainment / Party",
      "type": "expense",
      "default_nature": "want",
      "aliases": "nonton, bioskop, netflix, spotify, konser, karaoke, party, hangout",
      "active": true
    },
    {
      "id": "social",
      "group": "Lifestyle",
      "name": "Social",
      "type": "expense",
      "default_nature": "want",
      "aliases": "traktir, kado, hadiah, arisan, donasi, sumbangan, nikahan",
      "active": true
    },
    {
      "id": "electronic",
      "group": "Lifestyle",
      "name": "Electronic",
      "type": "expense",
      "default_nature": "want",
      "aliases": "gadget, charger, headset, elektronik, laptop, hp, kabel",
      "active": true
    },
    {
      "id": "express",
      "group": "Other",
      "name": "Express (courier / delivery)",
      "type": "expense",
      "default_nature": "",
      "aliases": "kurir, ongkir, jne, jnt, sicepat, paket, shipping",
      "active": true
    },
    {
      "id": "others",
      "group": "Other",
      "name": "Others",
      "type": "expense",
      "default_nature": "",
      "aliases": "lain-lain, misc, other",
      "active": true
    },
    {
      "id": "e-wallet-top-up",
      "group": "Other",
      "name": "E-wallet top-up",
      "type": "expense",
      "default_nature": "",
      "aliases": "topup, top up, gopay, ovo, dana, shopeepay, isi saldo",
      "active": true
    },
    {
      "id": "bank-fee",
      "group": "System",
      "name": "Bank fee",
      "type": "expense",
      "default_nature": "need",
      "aliases": "biaya admin, admin fee, bank fee, biaya transfer, biaya atm",
      "active": true
    },
    {
      "id": "unrecorded-cash",
      "group": "System",
      "name": "Unrecorded cash",
      "type": "both",
      "default_nature": "",
      "aliases": "",
      "active": true
    },
    {
      "id": "income-salary",
      "group": "Income",
      "name": "Salary",
      "type": "income",
      "default_nature": "",
      "aliases": "gaji, salary, payroll",
      "active": true
    },
    {
      "id": "income-bonus",
      "group": "Income",
      "name": "Bonus",
      "type": "income",
      "default_nature": "",
      "aliases": "bonus, thr",
      "active": true
    },
    {
      "id": "income-interest",
      "group": "Income",
      "name": "Interest",
      "type": "income",
      "default_nature": "",
      "aliases": "bunga, interest, cashback bank",
      "active": true
    },
    {
      "id": "income-sales",
      "group": "Income",
      "name": "Sales",
      "type": "income",
      "default_nature": "",
      "aliases": "jual, penjualan, sales, terjual",
      "active": true
    },
    {
      "id": "income-freelance",
      "group": "Income",
      "name": "Freelance",
      "type": "income",
      "default_nature": "",
      "aliases": "freelance, upwork, client, project, proyek",
      "active": true
    },
    {
      "id": "income-split-refund",
      "group": "Income",
      "name": "Split refund",
      "type": "income",
      "default_nature": "",
      "aliases": "patungan, split, bayar balik, ganti uang, refund split",
      "active": true
    },
    {
      "id": "income-others",
      "group": "Income",
      "name": "Others",
      "type": "income",
      "default_nature": "",
      "aliases": "lain-lain, misc, other income",
      "active": true
    },
    {
      "id": "income-cash",
      "group": "Income",
      "name": "Cash",
      "type": "income",
      "default_nature": "",
      "aliases": "",
      "active": false
    },
    {
      "id": "income-coffer",
      "group": "Income",
      "name": "Coffer",
      "type": "income",
      "default_nature": "",
      "aliases": "",
      "active": false
    },
    {
      "id": "income-deposit",
      "group": "Income",
      "name": "Deposit",
      "type": "income",
      "default_nature": "",
      "aliases": "",
      "active": false
    },
    {
      "id": "income-stock",
      "group": "Income",
      "name": "Stock",
      "type": "income",
      "default_nature": "",
      "aliases": "",
      "active": false
    },
    {
      "id": "income-bond",
      "group": "Income",
      "name": "Bond",
      "type": "income",
      "default_nature": "",
      "aliases": "",
      "active": false
    }
  ],
  "accounts": [
    {
      "account": "Cash",
      "opening_balance": 0,
      "opening_date": "",
      "liquid": true,
      "is_default": false
    },
    {
      "account": "BCA",
      "opening_balance": 0,
      "opening_date": "",
      "liquid": true,
      "is_default": true
    },
    {
      "account": "BNI",
      "opening_balance": 0,
      "opening_date": "",
      "liquid": true,
      "is_default": false
    },
    {
      "account": "Koperasi",
      "opening_balance": 0,
      "opening_date": "",
      "liquid": true,
      "is_default": false
    },
    {
      "account": "Investment",
      "opening_balance": 0,
      "opening_date": "",
      "liquid": false,
      "is_default": false
    }
  ],
  "recurring": [
    {
      "id": "R001",
      "name": "KPR & IPL",
      "type": "expense",
      "amount": 5000000,
      "account": "BCA",
      "to_account": "",
      "category_id": "kpr-ipl",
      "nature": "need",
      "cycle": "monthly",
      "interval": 1,
      "day": 5,
      "start_date": "2026-12-05",
      "end_date": "",
      "mode": "auto",
      "last_run": "",
      "active": true
    }
  ],
  "state": {
    "last_nudge_date": "",
    "llm_provider": "openai",
    "llm_model": "SET_ME",
    "timezone": "Asia/Jakarta"
  }
};
