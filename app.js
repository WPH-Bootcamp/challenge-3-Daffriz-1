const readline = require('readline');
const fs = require('fs');
const path = require('path');

// Konstanta Global
const DATA_FILE = path.join(__dirname, 'habits-data.json');
const REMINDER_INTERVAL = 10000; // 10 detik
const DAYS_IN_WEEK = 7;
const PROGRESS_BAR_LENGTH = 10;

// Setup interface CLI (Command Line)
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Menyimpan state prompt saat ini
let currentPromptText = '';
// -------------------------
// HELPER FUNCTIONS
// -------------------------

// Fungsi untuk membaca input dari user secara async
function askQuestion(question) {
  currentPromptText = question; // menyimpan prompt agar bisa tampil ulang setelah pengingat
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      currentPromptText = ''; // hapus prompt setelah dijawab
      resolve(answer.trim());
    });
  });
}

// Mengubah tanggal ke format ISO string
function formatDateISO(date = new Date()) {
  return new Date(date).toISOString();
}

// Mendapatkan tanggal awal minggu (Senin)
function startOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Ubah agar Senin = 0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d;
}

// Mengecek apakah dua tanggal ISO sama harinya
function isSameDayISO(aISO, bISO) {
  if (!aISO || !bISO) return false;
  const a = new Date(aISO);
  const b = new Date(bISO);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Membuat tampilan progress bar ASCII
function progressBar(percent) {
  const filled = Math.round((percent / 100) * PROGRESS_BAR_LENGTH);
  const empty = PROGRESS_BAR_LENGTH - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

// -------------------------
// USER PROFILE CLASS
// -------------------------

// Menyimpan informasi profil pengguna
class UserProfile {
  constructor(data = {}) {
    this.name = data.name ?? 'User';
    this.joinDate = data.joinDate ? new Date(data.joinDate) : new Date();
    this.totalHabits = data.totalHabits ?? 0;
    this.completedThisWeek = data.completedThisWeek ?? 0;
  }

  // Memperbarui statistik profil berdasarkan daftar habit
  updateStats(habits) {
    this.totalHabits = habits.length;
    // hitung total penyelesaian minggu ini di semua habit
    const start = startOfWeek();
    let total = 0;
    habits.forEach((h) => {
      total += h.getThisWeekCompletionsCount(start);
    });
    this.completedThisWeek = total;
  }

  // Menghitung berapa hari sejak user join
  getDaysJoined() {
    const now = new Date();
    const diffMs = now - this.joinDate;
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  // Konversi ke format JSON
  toJSON() {
    return {
      name: this.name,
      joinDate: this.joinDate.toISOString(),
      totalHabits: this.totalHabits,
      completedThisWeek: this.completedThisWeek,
    };
  }
}

// -------------------------
// HABIT CLASS
// -------------------------
// Representasi satu habit
class Habit {
  constructor({
    id = Date.now(),
    name = 'New Habit',
    targetFrequency = 7,
    completions = [],
    createdAt = new Date().toISOString(),
  } = {}) {
    this.id = id;
    this.name = name;
    this.targetFrequency = Number(targetFrequency) || 0;
    this.completions = completions || []; // array tanggal penyelesaian
    this.createdAt = createdAt;
  }

  // markComplete: Menandai habit selesai hari ini
  markComplete(date = new Date()) {
    const todayISO = formatDateISO(date);
    const already = this.completions.some((c) => isSameDayISO(c, todayISO));
    if (!already) {
      this.completions.push(todayISO);
      return true;
    }
    return false;
  }

  // Menghitung jumlah penyelesaian dalam minggu ini
  getThisWeekCompletionsCount(startOfWeekDate = startOfWeek()) {
    const start = new Date(startOfWeekDate);
    const end = new Date(start);
    end.setDate(start.getDate() + DAYS_IN_WEEK);
    return this.completions.filter((c) => {
      const d = new Date(c);
      return d >= start && d < end;
    }).length;
  }

  // Mendapatkan daftar tanggal penyelesaian minggu ini
  getThisWeekCompletions(startOfWeekDate = startOfWeek()) {
    const start = new Date(startOfWeekDate);
    const end = new Date(start);
    end.setDate(start.getDate() + DAYS_IN_WEEK);
    return this.completions.filter((c) => {
      const d = new Date(c);
      return d >= start && d < end;
    });
  }

  // Mengecek apakah habit sudah memenuhi target mingguan
  isCompletedThisWeek() {
    return this.getThisWeekCompletionsCount() >= this.targetFrequency;
  }

  // Menghitung persentase progress
  getProgressPercentage() {
    const done = this.getThisWeekCompletionsCount();
    if (this.targetFrequency <= 0) return 0;
    const percent = Math.min(
      100,
      Math.round((done / this.targetFrequency) * 100)
    );
    return percent;
  }

  // Status habit (Aktif / Selesai)
  getStatus() {
    return this.isCompletedThisWeek() ? 'Selesai' : 'Aktif';
  }

  // Format untuk disimpan ke file JSON
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      targetFrequency: this.targetFrequency,
      completions: this.completions,
      createdAt: this.createdAt,
    };
  }
}

// -------------------------
// HABIT TRACKER CLASS
// -------------------------
// Class utama yang mengatur seluruh aplikasi
class HabitTracker {
  constructor(dataFile = DATA_FILE) {
    this.dataFile = dataFile;
    this.userProfile = new UserProfile();
    this.habits = []; // array Contoh Habit
    this._reminderId = null;
    this.loadFromFile(); // otomatis muat data dari file
  }

  // ---------------------
  // FILE OPERATIONS
  // ---------------------
  loadFromFile() {
    try {
      if (!fs.existsSync(this.dataFile)) {
        // jika file belum ada, buat data baru
        this.habits = [];
        this.userProfile = new UserProfile({
          name: 'User',
          joinDate: new Date().toISOString(),
        });
        this.saveToFile();
        return;
      }
      const raw = fs.readFileSync(this.dataFile, 'utf8');
      const parsed = JSON.parse(raw);
      const up = parsed.userProfile ?? {};
      this.userProfile = new UserProfile(up);
      const habitsRaw = parsed.habits ?? [];
      this.habits = habitsRaw.map((h) => new Habit(h));
      // pastikan statistik terupdate
      this.userProfile.updateStats(this.habits);
    } catch (err) {
      console.error('Error loading data file:', err);
      // fallback ke data default
      this.habits = [];
      this.userProfile = new UserProfile({
        name: 'User',
        joinDate: new Date().toISOString(),
      });
    }
  }

  saveToFile() {
    try {
      this.userProfile.updateStats(this.habits);
      const payload = {
        userProfile: this.userProfile.toJSON(),
        habits: this.habits.map((h) => h.toJSON()),
      };
      fs.writeFileSync(this.dataFile, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
      console.error('Error saving data file:', err);
    }
  }

  clearAllData() {
    this.habits = [];
    this.userProfile = new UserProfile({
      name: this.userProfile.name,
      joinDate: new Date().toISOString(),
    });
    this.saveToFile();
  }

  // ---------------------
  // CRUD OPERATIONS
  // ---------------------
  addHabit(name, frequency) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const habit = new Habit({
      id,
      name: name ?? 'Untitled Habit',
      targetFrequency: Number(frequency) || 0,
      completions: [],
      createdAt: new Date().toISOString(),
    });
    this.habits.push(habit);
    this.saveToFile();
    return habit;
  }

  completeHabit(indexOrId) {
    // Bisa cari habit berdasarkan index atau ID
    let habit = null;
    if (typeof indexOrId === 'number') {
      const idx = indexOrId - 1;
      habit = this.habits[idx] ?? null;
    } else {
      habit = this.habits.find((h) => h.id === indexOrId) ?? null;
    }
    if (!habit) return { ok: false, message: 'Habit not found' };
    const done = habit.markComplete(new Date());
    if (done) {
      this.saveToFile();
      return { ok: true, message: `Tercatat: "${habit.name}" untuk hari ini.` };
    } else {
      return {
        ok: false,
        message: `Sudah ditandai hari ini: "${habit.name}".`,
      };
    }
  }

  deleteHabit(index) {
    const idx = index - 1;
    if (idx < 0 || idx >= this.habits.length) {
      return { ok: false, message: 'Index tidak valid' };
    }
    const deleted = this.habits.splice(idx, 1)[0];
    this.saveToFile();
    return { ok: true, message: `Habit "${deleted.name}" dihapus.` };
  }

  // ---------------------
  // DISPLAY / FILTER METHODS
  // ---------------------
  displayProfile() {
    this.userProfile.updateStats(this.habits);
    console.log('==================================================');
    console.log('PROFILE');
    console.log('==================================================');
    console.log(`Name           : ${this.userProfile.name}`);
    console.log(
      `Join Date      : ${this.userProfile.joinDate.toISOString().slice(0, 10)}`
    );
    console.log(`Days Joined    : ${this.userProfile.getDaysJoined()} hari`);
    console.log(`Total Habits   : ${this.userProfile.totalHabits}`);
    console.log(`Completed This Week : ${this.userProfile.completedThisWeek}`);
    console.log('==================================================\n');
  }

  displayAllHabits() {
    console.log('==================================================');
    console.log('ALL HABITS');
    console.log('==================================================');
    if (this.habits.length === 0) {
      console.log('Belum ada habits. Tambah habit baru dulu.\n');
      return;
    }
    // use forEach
    this.habits.forEach((h, i) => {
      const done = h.getThisWeekCompletionsCount();
      const percent = h.getProgressPercentage();
      console.log(`${i + 1}. [${h.getStatus()}] ${h.name}`);
      console.log(`   Target: ${h.targetFrequency}x/minggu`);
      console.log(`   Progress: ${done}/${h.targetFrequency} (${percent}%)`);
      console.log(`   Progress Bar: ${progressBar(percent)} ${percent}%`);
      console.log('');
    });
  }

  displayActiveHabits() {
    // filter
    const active = this.habits.filter((h) => !h.isCompletedThisWeek());
    console.log('==================================================');
    console.log('ACTIVE HABITS');
    console.log('==================================================');
    if (active.length === 0) {
      console.log('Semua habit sudah selesai minggu ini! 🎉\n');
      return;
    }
    active.forEach((h, i) => {
      const done = h.getThisWeekCompletionsCount();
      const percent = h.getProgressPercentage();
      console.log(
        `${i + 1}. ${h.name} — ${done}/${h.targetFrequency} (${percent}%)`
      );
    });
    console.log('');
  }

  displayCompletedHabits() {
    // filter
    const completed = this.habits.filter((h) => h.isCompletedThisWeek());
    console.log('==================================================');
    console.log('COMPLETED HABITS');
    console.log('==================================================');
    if (completed.length === 0) {
      console.log('Belum ada habit yang mencapai target minggu ini.\n');
      return;
    }
    completed.forEach((h, i) => {
      console.log(
        `${i + 1}. ${h.name} — Selesai (${h.getThisWeekCompletionsCount()}/${
          h.targetFrequency
        })`
      );
    });
    console.log('');
  }

  displayStats() {
    console.log('==================================================');
    console.log('STATISTICS SUMMARY');
    console.log('==================================================');
    // menggunakan map untuk mendapatkan nama-nama habit
    const names = this.habits.map((h) => h.name);
    console.log('Habit Names:', names.join(', ') || '-');
    // menggunakan reduce-like pattern untuk menghitung rata-rata progress
    const percentages = this.habits.map((h) => h.getProgressPercentage());
    const avg = percentages.length
      ? Math.round(percentages.reduce((a, b) => a + b, 0) / percentages.length)
      : 0;
    console.log('Average Progress :', avg + '%');
    // menggunakan find untuk menampilkan habit dengan progress tertinggi
    if (this.habits.length) {
      const highest = this.habits.reduce(
        (p, c) =>
          c.getProgressPercentage() > p.getProgressPercentage() ? c : p,
        this.habits[0]
      );
      console.log(
        `Top Habit : ${highest.name} (${highest.getProgressPercentage()}%)`
      );
    }
    // menggunakan filter untuk daftar habit dengan progress di bawah 50%
    const needy = this.habits.filter((h) => h.getProgressPercentage() < 50);
    console.log('Needs attention:', needy.map((h) => h.name).join(', ') || '-');
    console.log('==================================================\n');
  }

  // Demo penggunaan while loop
  displayHabitsWithWhile() {
    console.log('==================================================');
    console.log('DEMO: WHILE LOOP');
    console.log('==================================================');
    let i = 0;
    while (i < this.habits.length) {
      const h = this.habits[i];
      console.log(
        `${i + 1}. ${h.name} — ${h.getThisWeekCompletionsCount()}/${
          h.targetFrequency
        }`
      );
      i++;
    }
    if (this.habits.length === 0) console.log('(no habits)');
    console.log('');
  }

  displayHabitsWithFor() {
    console.log('==================================================');
    console.log('DEMO: FOR LOOP');
    console.log('==================================================');
    for (let i = 0; i < this.habits.length; i++) {
      const h = this.habits[i];
      console.log(
        `${i + 1}. ${h.name} — ${h.getThisWeekCompletionsCount()}/${
          h.targetFrequency
        }`
      );
    }
    if (this.habits.length === 0) console.log('(no habits)');
    console.log('');
  }

  // ---------------------
  // REMINDER SYSTEM
  // ---------------------
  showReminder() {
    // cari habit aktif pertama
    const active = this.habits.filter((h) => !h.isCompletedThisWeek());
    if (active.length === 0) return;
    const next = active[0];

    // bersihkan baris saat ini
    try {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
    } catch (e) {}

    console.log('\n==================================================');
    console.log(
      `REMINDER: Jangan lupa "${
        next.name
      }"! (${next.getThisWeekCompletionsCount()}/${next.targetFrequency})`
    );
    console.log('==================================================\n');

    // menampilkan ulang prompt saat ini
    if (currentPromptText !== undefined) {
      // rl.line adalah teks yang sudah diketik user
      const typed = rl.line || '';
      process.stdout.write(currentPromptText + typed);
    }
  }

  startReminder() {
    if (this._reminderId) return;
    this._reminderId = setInterval(
      () => this.showReminder(),
      REMINDER_INTERVAL
    );
  }

  stopReminder() {
    if (!this._reminderId) return;
    clearInterval(this._reminderId);
    this._reminderId = null;
  }

  // Menambahkan data demo
  seedDemoData() {
    if (this.habits.length > 0) return;
    this.addHabit('Minum Air 8 Gelas', 7);
    this.addHabit('Baca Buku 30 Menit', 5);
    // tandai beberapa penyelesaian agar demo lebih menarik
    const now = new Date();
    const h1 = this.habits[0];
    h1.completions.push(formatDateISO(now)); // hari ini
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    h1.completions.push(formatDateISO(yesterday));
    const h2 = this.habits[1];
    h2.completions.push(formatDateISO(now));
    this.saveToFile();
  }
}

// -------------------------
// CLI - MENU AND HANDLERS
// -------------------------
function displayMenuBanner() {
  console.log('==================================================');
  console.log('HABIT TRACKER - MAIN MENU');
  console.log('==================================================');
  console.log('1. Lihat Profil');
  console.log('2. Lihat Semua Kebiasaan');
  console.log('3. Lihat Kebiasaan Aktif');
  console.log('4. Lihat Kebiasaan Selesai');
  console.log('5. Tambah Kebiasaan Baru');
  console.log('6. Tandai Kebiasaan Selesai');
  console.log('7. Hapus Kebiasaan');
  console.log('8. Lihat Statistik');
  console.log('9. Demo Loop (while/for)');
  console.log('0. Keluar');
  console.log('==================================================');
}

async function handleMenu(tracker) {
  tracker.startReminder();
  while (true) {
    displayMenuBanner();
    const choice = await askQuestion('Pilih menu (0-9): ');
    switch (choice) {
      case '1':
        tracker.displayProfile();
        break;
      case '2':
        tracker.displayAllHabits();
        break;
      case '3':
        tracker.displayActiveHabits();
        break;
      case '4':
        tracker.displayCompletedHabits();
        break;
      case '5': {
        const name = await askQuestion('Nama habit: ');
        const freqInput = await askQuestion('Target per minggu (angka): ');
        const freq = Number(freqInput) ?? 0; // penggunaan nullish coalescing
        tracker.addHabit(name ?? 'Untitled Habit', freq);
        console.log('Habit ditambahkan!\n');
        break;
      }
      case '6': {
        tracker.displayAllHabits();
        if (tracker.habits.length === 0) break;
        const idxInput = await askQuestion(
          'Pilih nomor habit untuk ditandai selesai hari ini: '
        );
        const idx = Number(idxInput);
        const res = tracker.completeHabit(idx);
        console.log(res.message + '\n');
        break;
      }
      case '7': {
        tracker.displayAllHabits();
        if (tracker.habits.length === 0) break;
        const idxInput = await askQuestion('Pilih nomor habit untuk dihapus: ');
        const idx = Number(idxInput);
        const res = tracker.deleteHabit(idx);
        console.log(res.message + '\n');
        break;
      }
      case '8':
        tracker.displayStats();
        break;
      case '9':
        // Demo loops
        tracker.displayHabitsWithWhile();
        tracker.displayHabitsWithFor();
        break;
      case '0':
        tracker.stopReminder();
        console.log('Keluar. Sampai jumpa!');
        rl.close();
        return;
      default:
        console.log('Pilihan tidak valid. Silakan masukkan angka 0-9.\n');
        break;
    }
    // jeda singkat agar pengingat
    await new Promise((r) => setTimeout(r, 200));
  }
}

// -------------------------
// MAIN FUNCTIONS
// -------------------------
async function main() {
  console.clear();
  console.log('==================================================');
  console.log('WELCOME TO HABIT TRACKER CLI');
  console.log('==================================================\n');

  const tracker = new HabitTracker(DATA_FILE);

  // Tambah data demo jika file masih kosong
  if (
    tracker.habits.length === 0 &&
    (await askQuestion('Seed demo data? (y/n): ')).toLowerCase() === 'y'
  ) {
    tracker.seedDemoData();
    console.log('Demo data added.\n');
  }

  // mulai pengingat dan jalankan menu
  tracker.startReminder();
  await handleMenu(tracker);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  rl.close();
});
