const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const db = new sqlite3.Database('./civicpulse.db', (err) => {
    if (err) {
        console.error('Database connection error:', err);
        process.exit(1);
    }
});

// Set a new password
const newPassword = 'admin123';
const hashedPassword = bcrypt.hashSync(newPassword, 10);

db.run(
    `UPDATE authorities SET password = ? WHERE official_id = 'OFFICER_123'`,
    [hashedPassword],
    function(err) {
        if (err) {
            console.error('Error updating password:', err);
        } else {
            console.log('\n✓ Password successfully updated!');
            console.log('\nLogin credentials:');
            console.log('Official ID: OFFICER_123');
            console.log('Password: admin123');
            console.log('\nYou can now login with these credentials.\n');
        }
        db.close();
    }
);