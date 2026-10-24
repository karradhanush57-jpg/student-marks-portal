# CampusMarks Student Marks Portal

A VS Code-ready Node.js website implementing the Student Marks Portal requirements.

## Start
1. Install Node.js LTS.
2. Open this folder in VS Code.
3. Terminal → New Terminal.
4. Run:
   npm install
5. Run:
   npm start
6. Visit:
   http://localhost:3000

## Admin
http://localhost:3000/admin.html

Demo:
Email: admin@example.com
Password: admin123

## Features
- Student roll-number lookup
- Published/unpublished student records
- Excel/CSV import
- Import validation and duplicate detection
- Google Sheet public CSV URL sync
- Import history
- Audit log
- Admin student management
- Print/save PDF
- Responsive UI
- SQLite database
- Rate limiting and security headers

## Spreadsheet headers
Roll No, Name, Subject, Midterm 1, Midterm 2, Assignment, Semester, Total, Grade, Result, Class, Semester Name

## Production note
Before using real student data publicly, add PostgreSQL, HTTPS, secure cookies, environment secrets, CSRF protection, 2FA, stronger student verification than roll number alone, Google Sheets API/service account sync, scheduled sync, backup/rollback, and stricter mark-range validation.
