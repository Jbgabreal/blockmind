-- Migration script to fix existing projects that don't have user_id
-- This links projects to users based on the Privy user ID from app_users table

-- Step 1: Find projects without user_id
-- SELECT id, sandbox_id, name FROM projects WHERE user_id IS NULL;

-- Step 2: For each project, you need to manually link it to a user
-- Option A: If you know which user created it, update directly:
-- UPDATE projects 
-- SET user_id = (SELECT id FROM app_users WHERE privy_user_id = 'did:privy:YOUR_USER_ID_HERE')
-- WHERE sandbox_id = '067c62b6-873d-45cc-bddd-bbb65f086ek';

-- Option B: Link to the first user (if you only have one user):
-- UPDATE projects 
-- SET user_id = (SELECT id FROM app_users LIMIT 1)
-- WHERE user_id IS NULL;

-- Step 3: First, ensure sandboxes table has entries for all sandbox_ids used in projects
INSERT INTO sandboxes (sandbox_id, capacity, active_users)
SELECT DISTINCT p.sandbox_id, 5, 0
FROM projects p
WHERE p.sandbox_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sandboxes s 
    WHERE s.sandbox_id = p.sandbox_id
  )
ON CONFLICT (sandbox_id) DO NOTHING;

-- Step 4: Ensure user_sandboxes table is populated
-- This creates sandbox assignments for users who have projects but no sandbox assignment
INSERT INTO user_sandboxes (app_user_id, sandbox_id)
SELECT DISTINCT p.user_id, p.sandbox_id
FROM projects p
WHERE p.user_id IS NOT NULL
  AND p.sandbox_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_sandboxes us 
    WHERE us.app_user_id = p.user_id
  )
ON CONFLICT (app_user_id) DO NOTHING;

-- Step 5: Update sandboxes table to reflect active users
UPDATE sandboxes s
SET active_users = (
  SELECT COUNT(DISTINCT us.app_user_id)
  FROM user_sandboxes us
  WHERE us.sandbox_id = s.sandbox_id
);

-- Step 6: Verify the fix
-- Check projects now have user_id:
-- SELECT p.id, p.name, p.user_id, u.privy_user_id, u.email
-- FROM projects p
-- LEFT JOIN app_users u ON p.user_id = u.id;

