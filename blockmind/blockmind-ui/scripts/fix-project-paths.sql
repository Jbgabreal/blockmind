-- Migration script to fix project_path to use three-level structure:
-- /root/blockmind-projects/{user_id}/{sandbox_id}/{project_id}
-- This ensures each project has a unique directory path within its sandbox

-- Step 1: Update projects to use three-level path structure
-- Structure: /root/blockmind-projects/{user_id}/{sandbox_id}/{project_id}
UPDATE projects
SET 
  project_path = CONCAT(
    '/root/blockmind-projects/',
    user_id::text,
    '/',
    sandbox_id::text,
    '/',
    id::text  -- Use project.id as the final segment
  ),
  updated_at = NOW()
WHERE 
  project_path IS NOT NULL
  AND project_path != ''
  AND project_path NOT LIKE '%undefined%'
  AND user_id IS NOT NULL
  AND sandbox_id IS NOT NULL
  AND id IS NOT NULL
  AND (
    -- Case 1: Path doesn't have three levels (missing sandbox_id segment)
    (SPLIT_PART(project_path, '/', 5) IS NULL OR SPLIT_PART(project_path, '/', 5) = '')
    OR
    -- Case 2: Last part doesn't match project.id (should be 5th segment in three-level structure)
    SPLIT_PART(project_path, '/', 5) != id::text
  );

-- Step 2: Fix projects with "undefined" in path or missing path
UPDATE projects
SET 
  project_path = CONCAT(
    '/root/blockmind-projects/',
    user_id::text,
    '/',
    sandbox_id::text,
    '/',
    id::text
  ),
  updated_at = NOW()
WHERE 
  (project_path IS NULL OR project_path = '' OR project_path LIKE '%undefined%')
  AND user_id IS NOT NULL
  AND sandbox_id IS NOT NULL
  AND id IS NOT NULL;

-- Step 3: Verify results - check for any remaining duplicates
SELECT 
  project_path,
  COUNT(*) as project_count,
  array_agg(id::text) as project_ids,
  array_agg(name) as project_names
FROM projects
WHERE project_path IS NOT NULL
GROUP BY project_path
HAVING COUNT(*) > 1;

-- Step 4: Show projects that still need fixing
-- Path structure should be: /root/blockmind-projects/{user_id}/{sandbox_id}/{project_id}
-- So project.id should be the 5th segment (index 5)
SELECT 
  id,
  name,
  sandbox_id,
  project_path,
  user_id,
  CASE 
    WHEN project_path IS NULL OR project_path = '' THEN 'Missing path'
    WHEN project_path LIKE '%undefined%' THEN 'Contains undefined'
    WHEN SPLIT_PART(project_path, '/', 5) != id::text THEN 'Path uses wrong ID (should be 5th segment)'
    WHEN SPLIT_PART(project_path, '/', 4) != sandbox_id::text THEN 'Path missing sandbox_id segment'
    WHEN SPLIT_PART(project_path, '/', 3) != user_id::text THEN 'Path missing user_id segment'
    ELSE 'OK'
  END as status
FROM projects
WHERE 
  project_path IS NULL 
  OR project_path = ''
  OR project_path LIKE '%undefined%'
  OR SPLIT_PART(project_path, '/', 5) != id::text
  OR SPLIT_PART(project_path, '/', 4) != sandbox_id::text
  OR SPLIT_PART(project_path, '/', 3) != user_id::text
ORDER BY user_id, created_at;

