# NA'IBI Dental Clinic: website + online booking + staff portal

What is in this folder
- `index.html`, `img/`, `media/` : the existing Na'ibi website (now with "Book online" buttons)
- `book.html` : patients pick a service and a free time (no sign-in), and can check their booking
- `staff.html` : staff sign-in. Admin, receptionist, dentist and technician each see their own screens
- `setup.html` : a checker page that tells you which setup step is done
- `db/1-setup.sql`, `db/2-first-admin.sql` : the database, to paste into Supabase
- `api/staff.js` : creates and resets staff logins (runs on Vercel, uses a secret key stored in Vercel, never in the files)
- `js/config.js` : where your two Supabase values go

Tested here: booking rules (no double-booking, even with 8 people booking one slot at the same moment),
each role's permissions, account creation, password reset, leave, closed days and rosters, on a real
Postgres database with the real files. Not tested here: the real Supabase and Vercel services themselves
(this workspace cannot reach them), so the first run on your accounts is the real test. `setup.html` tells
you exactly what is missing if something is off.

## Setup, step by step (about 30 minutes the first time)

### 1. Supabase: create the database
1. Supabase dashboard > your project (create one if you have not: name `naibi`, any region near you, save the database password).
2. Left menu > **SQL Editor** > **New query**.
3. Open `db/1-setup.sql`, copy ALL of it, paste, press **Run**. You should see "Success. No rows returned".
4. Left menu > **Authentication** > **Users** > **Add user** > **Create new user**. Type YOUR email and a password.
   Tick **Auto Confirm User**. Create.
5. Open `db/2-first-admin.sql`. Change the email (same as step 4) and your name on the two marked lines.
   Paste it in a new SQL query and Run. You should see the notice "Done. ... is now an admin".
6. Left menu > **Authentication** > **Sign In / Providers** (or Settings): turn OFF **Allow new users to sign up**.
   Only the admin creates staff logins, so nobody else needs to register.
7. **Project Settings** > **API** (or **API Keys**): copy the **Project URL** and the **anon public** key
   (a "publishable" key also works). Also copy the **service_role** key (or "secret" key). Keep that one private.

### 2. GitHub: put the files online
1. Create an empty GitHub repository, for example `naibi-dental`.
2. Upload everything in this folder to it (GitHub > Add file > Upload files; keep the folders).
3. In the repo, open `js/config.js`, press the pencil icon, paste your **Project URL** and **anon public** key, commit.
   (These two are public by design. NEVER paste the service_role key here.)

### 3. Vercel: publish it
1. Vercel > **Add New** > **Project** > import the GitHub repo. Framework preset: **Other**. Leave build settings empty. **Deploy**.
2. Vercel > your project > **Settings** > **Environment Variables**. Add:
   - `SUPABASE_URL` = your Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = your service_role (or secret) key
3. **Deployments** > the latest one > **Redeploy** (so the function picks up the keys).
4. Open `https://YOUR-SITE.vercel.app/setup.html`. Every step should be green except "at least one dentist" (next).

### 4. First login and your team
1. Open `/staff.html`, sign in with the email and password from step 1.4.
2. **Staff and rosters** > create the dentists, technicians and receptionist. Each gets a starter roster
   (Mon to Sat, 9 AM to 5 PM, break 1 to 2 PM). Edit each roster and leave to match real life.
   Copy the sign-in details shown after creating each account and send them privately (there is a WhatsApp button).
3. **Settings**: check opening times (default 8 AM to 9 PM, every day), slot length, and whether online bookings
   confirm automatically. Edit services and their lengths. Mark which services need a technician.
4. Dentists: make sure each dentist has the right services ticked (new dentists start with all of them).

## How to test everything (you can be every role)
- As **admin**, use **Preview as** (top right) to see exactly what a dentist, technician or receptionist sees, without logging out.
- Patient side: open `/book.html` on your phone. Book a visit. Note the reference (NB-...).
  Check it under **My booking** with the same phone number.
- Try to break it: book the same time from two phones; it should only allow what is truly free.
  Add leave for a dentist, close a date, change a roster: the times on the booking page change straight away.
- Reception: confirm the booking, reschedule it, cancel it (the time becomes free again), book a walk-in.
- Messages: every booking, confirmation, cancellation and reschedule writes a ready message.
  Tap **Open WhatsApp**, send, then **Mark sent**. (Automatic SMS/WhatsApp sending is Phase 2.)
- Dentist: sign in with a dentist account, open a past visit, add notes, mark completed. Patients tab shows history by phone.
- Accounts: reset a password, deactivate a person (they are locked out immediately), reactivate.

## Good to know
- A visit already booked when you add leave, change a roster, or close a day is NOT cancelled automatically.
  It is flagged "needs rescheduling" on the Today tab so a person decides.
- Patients cannot cancel online (the owner asked that reception does this). They are told to call or WhatsApp.
- Supabase free projects can pause after a period of no use. If the booking page ever says it cannot connect,
  open the Supabase dashboard and press Restore. Upgrading the project avoids pausing.
- Staff passwords are handled by Supabase (never stored in these files). Sessions refresh automatically.
- Phase 2 (automatic reminders) plugs into the `messages` table that already exists.
