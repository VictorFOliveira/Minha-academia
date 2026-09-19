import bcrypt from 'bcryptjs';
import { pool } from './db.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const UNIT_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_ID = '33333333-3333-4333-8333-333333333333';
const SECOND_TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SECOND_UNIT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SECOND_OWNER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

export async function bootstrap() {
  const seedDemo = String(process.env.SEED_DEMO).toLowerCase() === 'true';
  const platformEmail = String(process.env.PLATFORM_ADMIN_EMAIL || '').trim().toLowerCase();
  const platformPassword = String(process.env.PLATFORM_ADMIN_PASSWORD || '');
  if (!seedDemo && !(platformEmail && platformPassword.length >= 8)) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (platformEmail && platformPassword.length >= 8) {
      const platformHash = await bcrypt.hash(platformPassword, 12);
      await client.query(`INSERT INTO platform_admins(name,email,password_hash)
        VALUES($1,$2,$3)
        ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,active=true`, [
        String(process.env.PLATFORM_ADMIN_NAME || 'Superadmin').trim() || 'Superadmin',
        platformEmail,
        platformHash
      ]);
    }

    if (!seedDemo) {
      await client.query('COMMIT');
      return;
    }
    await client.query(`INSERT INTO tenants(id,slug,legal_name,trade_name,cnpj,saas_plan,billing_status,settings)
      VALUES($1,'demo','Minha Academia Demo LTDA','Minha Academia Demo','00000000000000','PRO','ACTIVE',
      '{"branding":{"primaryColor":"#111827","accentColor":"#22c55e"}}'::jsonb)
      ON CONFLICT(id) DO NOTHING`, [TENANT_ID]);
    await client.query(`INSERT INTO units(id,tenant_id,name,address) VALUES($1,$2,'Unidade Centro','{"city":"Fortaleza","state":"CE"}')
      ON CONFLICT(id) DO NOTHING`, [UNIT_ID, TENANT_ID]);
    const hash = await bcrypt.hash('Academia@123', 12);
    await client.query(`INSERT INTO users(id,tenant_id,unit_id,name,email,password_hash,role)
      VALUES($1,$2,$3,'Administrador Demo','admin@minhaacademia.local',$4,'OWNER')
      ON CONFLICT(tenant_id,email) DO NOTHING`, [OWNER_ID, TENANT_ID, UNIT_ID, hash]);

    await client.query(`INSERT INTO plans(tenant_id,name,description,price_cents,billing_interval)
      VALUES($1,'Musculação Mensal','Acesso livre à musculação',12990,'MONTHLY'),
            ($1,'Completo','Musculação + aulas coletivas',17990,'MONTHLY')
      ON CONFLICT(tenant_id,name) DO NOTHING`, [TENANT_ID]);

    await client.query(`INSERT INTO students(tenant_id,unit_id,name,cpf,email,phone,status)
      VALUES($1,$2,'Ana Souza','00000000001','ana@example.local','85999990001','ACTIVE'),
            ($1,$2,'Carlos Lima','00000000002','carlos@example.local','85999990002','ACTIVE')
      ON CONFLICT DO NOTHING`, [TENANT_ID, UNIT_ID]);

    await client.query(`INSERT INTO classes(tenant_id,unit_id,name,modality,capacity,weekday,starts_at,ends_at)
      SELECT $1,$2,'Funcional 18h','Funcional',20,1,'18:00','19:00'
      WHERE NOT EXISTS (SELECT 1 FROM classes WHERE tenant_id=$1 AND name='Funcional 18h')`, [TENANT_ID, UNIT_ID]);

    await client.query(`INSERT INTO tenants(id,slug,legal_name,trade_name,saas_plan,billing_status)
      VALUES($1,'isolamento','Tenant de Isolamento','Academia Isolada','STARTER','ACTIVE')
      ON CONFLICT(id) DO NOTHING`, [SECOND_TENANT]);
    await client.query(`INSERT INTO units(id,tenant_id,name) VALUES($1,$2,'Unidade Teste')
      ON CONFLICT(id) DO NOTHING`, [SECOND_UNIT, SECOND_TENANT]);
    const secondHash = await bcrypt.hash('Isolation@123', 12);
    await client.query(`INSERT INTO users(id,tenant_id,unit_id,name,email,password_hash,role)
      VALUES($1,$2,$3,'Admin Isolamento','admin@isolamento.local',$4,'OWNER')
      ON CONFLICT(tenant_id,email) DO NOTHING`, [SECOND_OWNER, SECOND_TENANT, SECOND_UNIT, secondHash]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
