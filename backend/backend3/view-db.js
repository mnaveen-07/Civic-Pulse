const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./civicpulse.db');

// View all users
console.log('\n=== USERS ===');
db.all('SELECT * FROM users', (err, rows) => {
    if (err) console.error(err);
    console.table(rows);
});

// View all issues
console.log('\n=== ISSUES ===');
db.all('SELECT * FROM issues', (err, rows) => {
    if (err) console.error(err);
    console.table(rows);
});

// View all comments
console.log('\n=== COMMENTS ===');
db.all('SELECT * FROM comments', (err, rows) => {
    if (err) console.error(err);
    console.table(rows);
});

db.close();