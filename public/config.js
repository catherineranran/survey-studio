// Survey Studio runtime settings.
//
// Leave both values empty to keep everything in the browser (local mode).
// To collect responses from anyone, create a free Supabase project, run
// supabase/schema.sql in its SQL editor, then paste the project URL and the
// "anon public" key here (Project Settings -> API). The anon key is designed
// to be public; the database's row-level security keeps your data private.
window.SURVEY_STUDIO_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
