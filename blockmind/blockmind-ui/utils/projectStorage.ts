// Project Storage - Using Supabase for persistence
// Falls back to localStorage if Supabase is not configured or API fails

export interface SavedProject {
  id: string; // sandboxId
  name: string;
  prompt: string;
  previewUrl?: string;
  sandboxId?: string;
  projectPath?: string;
  devPort?: number;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "blockmind-saved-projects";
const OLD_STORAGE_KEY = "lovable-saved-projects"; // Migration from old key

// Check if Supabase is configured
const isSupabaseConfigured = () => {
  return typeof window !== 'undefined' && 
         process.env.NEXT_PUBLIC_SUPABASE_URL && 
         process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
};

// Fallback to localStorage functions
function saveToLocalStorage(project: SavedProject): void {
  if (typeof window === "undefined") return;
  
  const projects = getFromLocalStorage();
  const existingIndex = projects.findIndex(p => p.id === project.id);
  
  if (existingIndex >= 0) {
    projects[existingIndex] = project;
  } else {
    projects.push(project);
  }
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

function getFromLocalStorage(): SavedProject[] {
  if (typeof window === "undefined") return [];
  
  try {
    let data = localStorage.getItem(STORAGE_KEY);
    
    // If no data with new key, try migrating from old key
    if (!data) {
      const oldData = localStorage.getItem(OLD_STORAGE_KEY);
      if (oldData) {
        localStorage.setItem(STORAGE_KEY, oldData);
        localStorage.removeItem(OLD_STORAGE_KEY);
        data = oldData;
      }
    }
    
    if (!data) return [];
    
    const projects = JSON.parse(data) as SavedProject[];
    return projects.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (error) {
    console.error("Error reading saved projects from localStorage:", error);
    return [];
  }
}

function deleteFromLocalStorage(sandboxId: string): void {
  if (typeof window === "undefined") return;
  
  const projects = getFromLocalStorage();
  const filtered = projects.filter(p => p.id !== sandboxId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

// Supabase API functions
async function saveProjectToAPI(project: Omit<SavedProject, "createdAt" | "updatedAt">): Promise<SavedProject | null> {
  try {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: project.id,
        name: project.name,
        prompt: project.prompt,
        previewUrl: project.previewUrl,
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data.project;
  } catch (error) {
    console.error('Error saving project to API:', error);
    return null;
  }
}

async function getProjectsFromAPI(): Promise<SavedProject[]> {
  try {
    const response = await fetch('/api/projects');
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data.projects || [];
  } catch (error) {
    console.error('Error fetching projects from API:', error);
    return [];
  }
}

async function getProjectFromAPI(sandboxId: string): Promise<SavedProject | null> {
  try {
    const response = await fetch(`/api/projects/${sandboxId}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data.project || null;
  } catch (error) {
    console.error('Error fetching project from API:', error);
    return null;
  }
}

async function updateProjectInAPI(sandboxId: string, updates: Partial<SavedProject>): Promise<SavedProject | null> {
  try {
    const response = await fetch(`/api/projects/${sandboxId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data.project;
  } catch (error) {
    console.error('Error updating project in API:', error);
    return null;
  }
}

async function deleteProjectFromAPI(sandboxId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/projects/${sandboxId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return true;
  } catch (error) {
    console.error('Error deleting project from API:', error);
    return false;
  }
}

// Public API - Hybrid approach (Supabase + localStorage fallback)
export async function saveProject(project: Omit<SavedProject, "createdAt" | "updatedAt">): Promise<void> {
  if (typeof window === "undefined") return;
  
  // Try Supabase first if configured
  if (isSupabaseConfigured()) {
    const savedProject = await saveProjectToAPI(project);
    if (savedProject) {
      // Also save to localStorage as backup
      saveToLocalStorage(savedProject);
      return;
    }
    // If API fails, fall through to localStorage
    console.warn('Supabase save failed, falling back to localStorage');
  }
  
  // Fallback to localStorage
  const existingProjects = getFromLocalStorage();
  const existingIndex = existingProjects.findIndex(p => p.id === project.id);
  
  const projectData: SavedProject = {
    ...project,
    createdAt: existingIndex >= 0 ? existingProjects[existingIndex].createdAt : Date.now(),
    updatedAt: Date.now(),
  };
  
  saveToLocalStorage(projectData);
}

export async function getSavedProjects(): Promise<SavedProject[]> {
  if (typeof window === "undefined") return [];
  
  // Try Supabase first if configured
  if (isSupabaseConfigured()) {
    const projects = await getProjectsFromAPI();
    if (projects.length > 0 || !getFromLocalStorage().length) {
      // If we got projects from API or localStorage is empty, use API result
      // Sync to localStorage for offline access
      projects.forEach(project => saveToLocalStorage(project));
      return projects;
    }
    // If API returned empty but localStorage has data, use localStorage
    console.warn('Supabase returned empty, using localStorage');
  }
  
  // Fallback to localStorage
  return getFromLocalStorage();
}

export async function getProject(sandboxId: string): Promise<SavedProject | null> {
  if (typeof window === "undefined") return null;
  
  // Try Supabase first if configured
  if (isSupabaseConfigured()) {
    const project = await getProjectFromAPI(sandboxId);
    if (project) {
      saveToLocalStorage(project);
      return project;
    }
  }
  
  // Fallback to localStorage
  const projects = getFromLocalStorage();
  return projects.find(p => p.id === sandboxId) || null;
}

export async function deleteProject(sandboxId: string): Promise<void> {
  if (typeof window === "undefined") return;
  
  // Try Supabase first if configured
  if (isSupabaseConfigured()) {
    const success = await deleteProjectFromAPI(sandboxId);
    if (success) {
      deleteFromLocalStorage(sandboxId);
      return;
    }
    console.warn('Supabase delete failed, falling back to localStorage');
  }
  
  // Fallback to localStorage
  deleteFromLocalStorage(sandboxId);
}

export async function updateProject(sandboxId: string, updates: Partial<SavedProject>): Promise<void> {
  if (typeof window === "undefined") return;
  
  // Try Supabase first if configured
  if (isSupabaseConfigured()) {
    const updatedProject = await updateProjectInAPI(sandboxId, updates);
    if (updatedProject) {
      saveToLocalStorage(updatedProject);
      return;
    }
    console.warn('Supabase update failed, falling back to localStorage');
  }
  
  // Fallback to localStorage
  const projects = getFromLocalStorage();
  const index = projects.findIndex(p => p.id === sandboxId);
  
  if (index >= 0) {
    projects[index] = {
      ...projects[index],
      ...updates,
      updatedAt: Date.now(),
    };
    saveToLocalStorage(projects[index]);
  }
}
