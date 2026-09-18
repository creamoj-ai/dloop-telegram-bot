const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://aqpwfurradxbnqvycvkm.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'YOUR_KEY';

async function checkColumns() {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const { data, error } = await supabase
    .from('information_schema.columns')
    .select('column_name, data_type')
    .eq('table_name', 'orders')
    .in('column_name', ['rider_reserved_at', 'rider_confirmed_at', 'rider_reminder_sent_at', 'confirmation_prompt_sent_at']);
  
  if (error) {
    console.log('RPC approach, trying direct query...');
    return;
  }
  
  console.log(JSON.stringify(data, null, 2));
}

checkColumns().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
