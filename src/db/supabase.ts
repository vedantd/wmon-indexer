import { createClient, SupabaseClient } from '@supabase/supabase-js';
import 'dotenv/config';

// Initialize Supabase client from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment');
  console.error('   Copy .env.example to .env and fill in your keys');
  process.exit(1);
}

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Test the database connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    const { error } = await supabase.from('transfers').select('count').limit(1);
    if (error && error.code === '42P01') {
      // Table doesn't exist yet - that's okay, we'll create it
      console.log('⚠️  transfers table not found. Please create it in Supabase.');
      return false;
    }
    if (error) {
      console.error('Database connection error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Failed to connect to Supabase:', err);
    return false;
  }
}
