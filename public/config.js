// Survey Studio runtime settings.
//
// Leave both values empty to keep everything in the browser (local mode).
// To collect responses from anyone, create a free Supabase project, run
// supabase/schema.sql in its SQL editor, then paste the project URL and the
// "anon public" key here (Project Settings -> API). The anon key is designed
// to be public; the database's row-level security keeps your data private.
// This copy (ranranli.net/survey-studio) uses Ranran Li's Supabase project.
// If you reuse this code, replace both values with your own project's.
window.SURVEY_STUDIO_CONFIG = {
  supabaseUrl: 'https://dcucmzobeolwvhibavfl.supabase.co',
  supabaseAnonKey: 'sb_publishable_T_E73ky6YPaN7ZYvT-xE-A_J88sI5Oi',
};
