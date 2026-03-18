import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  Image as ImageIcon, 
  Download, 
  Loader2, 
  Settings2, 
  Layers, 
  Maximize2, 
  Type, 
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Key,
  Plus,
  X,
  Hash,
  Upload,
  Eraser,
  Brush,
  Save,
  Trash2,
  History,
  Clock,
  GripVertical,
  Library,
  Sparkles,
  Edit2,
  Copy,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
    process?: {
      env: {
        API_KEY?: string;
        [key: string]: string | undefined;
      };
    };
  }
}

type Resolution = "1K" | "2K" | "4K";
type AspectRatio = "1:1" | "3:4" | "4:3" | "9:16" | "16:9";

interface ReferenceImage {
  id: string;
  url: string;
}

interface GenerationResult {
  id: string;
  url: string;
  prompt: string;
  resolution: Resolution;
  aspectRatio: AspectRatio;
  timestamp: number;
  isEdit?: boolean;
}

interface Task {
  id: string;
  prompt: string;
  count: number;
  resolutions: Resolution[];
  aspectRatio: AspectRatio;
  referenceImages?: string[]; // base64 array
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  total: number;
  error?: string;
  isEdit?: boolean;
}

interface PromptPreset {
  id: string;
  title: string;
  content: string;
  category: string;
  timestamp: number;
  isSystem?: boolean;
  preferredAspectRatio?: AspectRatio | 'default';
}

const PROMPT_CATEGORIES = ['角色', '场景', '风格', '光影', '工具', '其他'];

const DEFAULT_SYSTEM_PRESETS: PromptPreset[] = [
  {
    id: 'sys-four-views',
    title: '生成四视图',
    content: '生成全身三视图和一张面部特写（最左边占满三分之一的位置是超大的面部特写，右边三分之二放全身正视图、全身侧视图、全身背面图），纯白背景',
    category: '角色',
    timestamp: Date.now(),
    isSystem: true,
    preferredAspectRatio: '16:9'
  },
  {
    id: 'sys-cel-shaded',
    title: '2D赛璐璐风格',
    content: '2D Cel-shaded style, anime aesthetic, clean lines, flat colors, high quality',
    category: '风格',
    timestamp: Date.now(),
    isSystem: true,
    preferredAspectRatio: 'default'
  },
  {
    id: 'sys-us-comic',
    title: '2D美漫风格',
    content: '2D American comic book style, bold lines, dynamic shadows, vibrant colors, superhero aesthetic',
    category: '风格',
    timestamp: Date.now(),
    isSystem: true,
    preferredAspectRatio: 'default'
  },
  {
    id: 'sys-3d-china',
    title: '3D国创',
    content: '3D Chinese animation style, high quality, detailed textures, stylized characters, modern CGI',
    category: '风格',
    timestamp: Date.now(),
    isSystem: true,
    preferredAspectRatio: 'default'
  },
  {
    id: 'sys-3d-cgi-china',
    title: '国风古风高精 3D CGI',
    content: 'Traditional Chinese style, ancient aesthetic, high-definition 3D CGI, intricate details, cinematic lighting, masterpiece',
    category: '风格',
    timestamp: Date.now(),
    isSystem: true,
    preferredAspectRatio: 'default'
  },
  {
    id: 'sys-shinkai',
    title: '2D日漫新海诚风格',
    content: 'Makoto Shinkai style, 2D Japanese anime, breathtaking scenery, emotional lighting, high detail, vibrant sky, cinematic atmosphere',
    category: '风格',
    timestamp: Date.now(),
    isSystem: true,
    preferredAspectRatio: 'default'
  }
];

// --- IndexedDB Helpers ---

const DB_NAME = 'NanoBananaDB';
const STORE_NAME = 'results';
const TASKS_STORE = 'tasks';
const PRESETS_STORE = 'presets';

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 3); // Bump version to 3
    request.onupgradeneeded = (e: any) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(TASKS_STORE)) {
        db.createObjectStore(TASKS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(PRESETS_STORE)) {
        db.createObjectStore(PRESETS_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const dbSaveTasks = async (tasks: Task[]) => {
  try {
    const db = await initDB();
    const tx = db.transaction(TASKS_STORE, 'readwrite');
    const store = tx.objectStore(TASKS_STORE);
    store.clear();
    tasks.forEach(task => store.put(task));
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('Failed to save tasks to IndexedDB:', err);
  }
};

const dbGetTasks = async (): Promise<Task[]> => {
  try {
    const db = await initDB();
    const tx = db.transaction(TASKS_STORE, 'readonly');
    const store = tx.objectStore(TASKS_STORE);
    const request = store.getAll();
    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  } catch (err) {
    console.error('Failed to get tasks from IndexedDB:', err);
    return [];
  }
};

const dbSavePresets = async (presets: PromptPreset[]) => {
  try {
    const db = await initDB();
    const tx = db.transaction(PRESETS_STORE, 'readwrite');
    const store = tx.objectStore(PRESETS_STORE);
    store.clear();
    presets.forEach(p => store.put(p));
  } catch (err) {
    console.error('Failed to save presets to IndexedDB:', err);
  }
};

const dbGetPresets = async (): Promise<PromptPreset[]> => {
  try {
    const db = await initDB();
    const tx = db.transaction(PRESETS_STORE, 'readonly');
    const store = tx.objectStore(PRESETS_STORE);
    const request = store.getAll();
    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  } catch (err) {
    console.error('Failed to get presets from IndexedDB:', err);
    return [];
  }
};

const dbSaveResult = async (result: GenerationResult) => {
  try {
    const db = await initDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(result);
  } catch (err) {
    console.error('Failed to save to IndexedDB:', err);
  }
};

const dbGetAllResults = async (): Promise<GenerationResult[]> => {
  try {
    const db = await initDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    return new Promise((resolve) => {
      request.onsuccess = () => {
        const sorted = (request.result as GenerationResult[]).sort((a, b) => b.timestamp - a.timestamp);
        resolve(sorted);
      };
      request.onerror = () => resolve([]);
    });
  } catch (err) {
    console.error('Failed to get from IndexedDB:', err);
    return [];
  }
};

const dbClearResults = async () => {
  try {
    const db = await initDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
  } catch (err) {
    console.error('Failed to clear IndexedDB:', err);
  }
};

const dbDeleteResult = async (id: string) => {
  try {
    const db = await initDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
  } catch (err) {
    console.error('Failed to delete from IndexedDB:', err);
  }
};

// --- Components ---

const App: React.FC = () => {
  // --- State ---
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem('gemini_api_key') || '');
  const [showKeyInput, setShowKeyInput] = useState<boolean>(false);
  const [hasPlatformKey, setHasPlatformKey] = useState<boolean>(false);
  const [notification, setNotification] = useState<{ message: string, type: 'error' | 'success' } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ message: string, onConfirm: () => void } | null>(null);
  
  const [prompt, setPrompt] = useState<string>('');
  const [count, setCount] = useState<number>(1);
  const [selectedResolutions, setSelectedResolutions] = useState<Resolution[]>(["2K"]);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const tasksRef = useRef<Task[]>([]);
  const [results, setResults] = useState<GenerationResult[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const isProcessingRef = useRef(false);
  const isInitialLoadComplete = useRef(false);
  
  const [undoTask, setUndoTask] = useState<Task | null>(null);
  const [undoCountdown, setUndoCountdown] = useState<number>(3);
  const undoCancelRef = useRef<((proceed?: boolean) => void) | null>(null);
  
  const [promptPresets, setPromptPresets] = useState<PromptPreset[]>([]);
  const [isPromptDrawerOpen, setIsPromptDrawerOpen] = useState<boolean>(false);
  const [drawerWidth, setDrawerWidth] = useState<number>(320);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [isAddingPreset, setIsAddingPreset] = useState<boolean>(false);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [newPresetTitle, setNewPresetTitle] = useState<string>('');
  const [newPresetContent, setNewPresetContent] = useState<string>('');
  const [newPresetCategory, setNewPresetCategory] = useState<string>('其他');
  const [newPresetAspectRatio, setNewPresetAspectRatio] = useState<AspectRatio | 'default'>('default');
  const [selectedCategory, setSelectedCategory] = useState<string>('全部');
  
  const [selectedImage, setSelectedImage] = useState<GenerationResult | null>(null);
  const [editingImage, setEditingImage] = useState<{ url: string; prompt?: string } | null>(null);
  
  // --- Refs ---
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const isDrawing = useRef<boolean>(false);

  // --- Persistence ---
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio?.hasSelectedApiKey) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasPlatformKey(hasKey);
      }
    };
    checkKey();
  }, []);

  useEffect(() => {
    const loadResults = async () => {
      const [savedResults, savedTasks, savedPresets] = await Promise.all([
        dbGetAllResults(),
        dbGetTasks(),
        dbGetPresets()
      ]);
      setResults(savedResults);
      setTasks(savedTasks);
      
      // Merge system presets with saved presets
      const mergedPresets = [...savedPresets];
      DEFAULT_SYSTEM_PRESETS.forEach(systemPreset => {
        const existingIndex = mergedPresets.findIndex(p => p.id === systemPreset.id);
        if (existingIndex === -1) {
          mergedPresets.push(systemPreset);
        } else if (mergedPresets[existingIndex].isSystem) {
          // Update system preset category if it changed in code
          mergedPresets[existingIndex].category = systemPreset.category;
        }
      });
      setPromptPresets(mergedPresets);
      
      isInitialLoadComplete.current = true;
      
      // Clean up old localStorage data
      localStorage.removeItem('nanobanana_tasks');
    };
    loadResults();
  }, []);

  useEffect(() => {
    if (isInitialLoadComplete.current) {
      dbSaveTasks(tasks);
    }
  }, [tasks]);

  useEffect(() => {
    if (isInitialLoadComplete.current) {
      dbSavePresets(promptPresets);
    }
  }, [promptPresets]);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => {
        setNotification(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // --- Resizing Logic ---
  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth >= 280 && newWidth <= 800) {
        setDrawerWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // --- Queue Processing ---
  useEffect(() => {
    const processQueue = async () => {
      if (isProcessingRef.current) return;
      
      isProcessingRef.current = true;
      setIsProcessing(true);

      try {
        while (true) {
          const nextTask = tasksRef.current.find(t => t.status === 'pending');
          if (!nextTask) break;

          // Update task status to running
          setTasks(prev => prev.map(t => t.id === nextTask.id ? { ...t, status: 'running' } : t));

          // Create a new instance right before the call to get the latest key
          const currentApiKey = window.process?.env?.API_KEY || apiKey;
          
          if (!currentApiKey && !hasPlatformKey) {
            throw new Error("请先设置 API 密钥或选择平台密钥");
          }

          const ai = new GoogleGenAI({ apiKey: currentApiKey || '' });
          
          try {
            for (const res of nextTask.resolutions) {
              for (let i = 0; i < nextTask.count; i++) {
                // Check if task still exists (not deleted)
                if (!tasksRef.current.some(t => t.id === nextTask.id)) {
                  throw new Error("TASK_CANCELLED");
                }

                const parts: any[] = [];
                
                if (nextTask.referenceImages && nextTask.referenceImages.length > 0) {
                  nextTask.referenceImages.forEach(imgBase64 => {
                    const mimeType = imgBase64.split(';')[0].split(':')[1] || 'image/png';
                    const data = imgBase64.split(',')[1];
                    if (data) {
                      parts.push({
                        inlineData: {
                          data,
                          mimeType
                        }
                      });
                    }
                  });
                }

                parts.push({ text: nextTask.prompt });

                const response = await ai.models.generateContent({
                  model: 'gemini-3.1-flash-image-preview',
                  contents: { parts },
                  config: {
                    imageConfig: {
                      aspectRatio: nextTask.aspectRatio,
                      imageSize: res
                    }
                  },
                });

                let imageUrl = '';
                if (!response.candidates || response.candidates.length === 0 || !response.candidates[0].content || !response.candidates[0].content.parts) {
                  throw new Error("模型未返回有效结果，请检查提示词或 API 状态");
                }

                for (const part of response.candidates[0].content.parts) {
                  if (part.inlineData) {
                    imageUrl = `data:image/png;base64,${part.inlineData.data}`;
                    break;
                  }
                }

                if (imageUrl) {
                  const result: GenerationResult = {
                    id: Math.random().toString(36).substring(7),
                    url: imageUrl,
                    prompt: nextTask.prompt,
                    resolution: res,
                    aspectRatio: nextTask.aspectRatio,
                    timestamp: Date.now(),
                    isEdit: nextTask.isEdit
                  };
                  setResults(prev => [result, ...prev]);
                  await dbSaveResult(result);
                }
                
                setTasks(prev => prev.map(t => 
                  t.id === nextTask.id 
                    ? { ...t, progress: t.progress + 1 } 
                    : t
                ));
              }
            }
            
            setTasks(prev => prev.map(t => t.id === nextTask.id ? { ...t, status: 'completed' } : t));
          } catch (err: any) {
            if (err.message === "TASK_CANCELLED") {
              console.log("Task was cancelled by user");
              // Continue to next task in while loop
              continue;
            }
            throw err; // Re-throw to outer catch for non-cancellation errors
          }
        }
      } catch (err: any) {
        console.error("Queue error:", err);
        // Find the task that failed (if any)
        const currentTask = tasksRef.current.find(t => t.status === 'running');
        if (currentTask) {
          if (err.message?.includes("Requested entity was not found")) {
            setHasPlatformKey(false);
          }
          setTasks(prev => prev.map(t => t.id === currentTask.id ? { ...t, status: 'failed', error: err.message } : t));
        }
      } finally {
        isProcessingRef.current = false;
        setIsProcessing(false);
      }
    };

    processQueue();
  }, [tasks, apiKey, hasPlatformKey]);

  // --- Handlers ---
  const handleSaveKey = () => {
    localStorage.setItem('gemini_api_key', apiKey);
    setShowKeyInput(false);
  };

  const clearAllHistory = async () => {
    setConfirmModal({
      message: '确定要清空所有生成历史吗？此操作不可撤销。',
      onConfirm: async () => {
        setResults([]);
        await dbClearResults();
        setNotification({ message: '历史已清空', type: 'success' });
      }
    });
  };

  const deleteSingleResult = async (id: string) => {
    setResults(prev => prev.filter(r => r.id !== id));
    await dbDeleteResult(id);
  };

  const addReferenceImage = (url: string) => {
    if (referenceImages.length >= 3) {
      setNotification({ message: '最多支持3张参考图', type: 'error' });
      return;
    }
    setReferenceImages(prev => [...prev, { id: Math.random().toString(36).substring(7), url }]);
  };

  const addPromptPreset = () => {
    if (!newPresetTitle.trim() || !newPresetContent.trim()) {
      setNotification({ message: '标题和内容不能为空', type: 'error' });
      return;
    }
    
    if (editingPresetId) {
      // Update existing
      setPromptPresets(prev => prev.map(p => 
        p.id === editingPresetId 
          ? { ...p, title: newPresetTitle, content: newPresetContent, category: newPresetCategory, preferredAspectRatio: newPresetAspectRatio, timestamp: Date.now() }
          : p
      ));
      setEditingPresetId(null);
      setNotification({ message: '提示词已更新', type: 'success' });
    } else {
      // Add new
      const newPreset: PromptPreset = {
        id: Math.random().toString(36).substring(7),
        title: newPresetTitle,
        content: newPresetContent,
        category: newPresetCategory,
        preferredAspectRatio: newPresetAspectRatio,
        timestamp: Date.now()
      };
      setPromptPresets(prev => [newPreset, ...prev]);
      setNotification({ message: '提示词已保存', type: 'success' });
    }
    
    setNewPresetTitle('');
    setNewPresetContent('');
    setNewPresetCategory('其他');
    setNewPresetAspectRatio('default');
    setIsAddingPreset(false);
  };

  const startEditingPreset = (preset: PromptPreset) => {
    setEditingPresetId(preset.id);
    setNewPresetTitle(preset.title);
    setNewPresetContent(preset.content);
    setNewPresetCategory(preset.category);
    setNewPresetAspectRatio(preset.preferredAspectRatio || 'default');
    setIsAddingPreset(true);
  };

  const restoreSystemPreset = (id: string) => {
    const defaultPreset = DEFAULT_SYSTEM_PRESETS.find(p => p.id === id);
    if (defaultPreset) {
      setPromptPresets(prev => prev.map(p => 
        p.id === id ? { ...defaultPreset, timestamp: Date.now() } : p
      ));
      setNotification({ message: '已恢复默认设置', type: 'success' });
    }
  };

  const restoreAllDefaults = () => {
    setPromptPresets(DEFAULT_SYSTEM_PRESETS);
    setNotification({ message: '已重置所有系统预设', type: 'success' });
  };

  const deletePromptPreset = (id: string) => {
    setPromptPresets(prev => prev.filter(p => p.id !== id));
    setNotification({ message: '提示词已删除', type: 'success' });
  };

  const copyPromptPreset = (preset: PromptPreset) => {
    const text = `${preset.title}\n${preset.content}`;
    navigator.clipboard.writeText(text).then(() => {
      setNotification({ message: '已复制到剪贴板', type: 'success' });
    }).catch(err => {
      console.error('Failed to copy:', err);
      setNotification({ message: '复制失败', type: 'error' });
    });
  };

  const usePromptPreset = (preset: PromptPreset) => {
    setPrompt(prev => prev ? `${prev}, ${preset.content}` : preset.content);
    
    // Use preferred aspect ratio if set
    if (preset.preferredAspectRatio && preset.preferredAspectRatio !== 'default') {
      setAspectRatio(preset.preferredAspectRatio);
    }
    
    setNotification({ message: '已应用提示词', type: 'success' });
  };

  const removeReferenceImage = (id: string) => {
    setReferenceImages(prev => prev.filter(img => img.id !== id));
  };

  const handleOpenSelectKey = async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      setHasPlatformKey(true);
    }
  };

  const deleteTask = (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  const retryTask = (id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'pending', progress: 0, error: undefined } : t));
  };

  const [isAddingToQueue, setIsAddingToQueue] = useState(false);

  const addTask = (isEdit = false, customImage?: string) => {
    if (!prompt.trim() && !isEdit) return;
    
    setIsAddingToQueue(true);
    setTimeout(() => setIsAddingToQueue(false), 1000);

    const currentApiKey = window.process?.env?.API_KEY || apiKey;
    if (!currentApiKey && !hasPlatformKey) {
      if (window.aistudio?.openSelectKey) {
        handleOpenSelectKey();
      } else {
        setShowKeyInput(true);
      }
      return;
    }

    const newTask: Task = {
      id: Math.random().toString(36).substring(7),
      prompt: prompt,
      count: isEdit ? 1 : count,
      resolutions: selectedResolutions,
      aspectRatio: aspectRatio,
      referenceImages: isEdit ? (customImage ? [customImage] : []) : referenceImages.map(img => img.url),
      status: 'pending',
      progress: 0,
      total: (isEdit ? 1 : count) * selectedResolutions.length,
      isEdit
    };

    // --- 3s Undo Delay ---
    if (undoCancelRef.current) {
      undoCancelRef.current(true); // Proceed with previous task immediately
    }

    setUndoTask(newTask);
    setUndoCountdown(3);

    let countdown = 3;
    const interval = setInterval(() => {
      countdown -= 1;
      setUndoCountdown(countdown);
      if (countdown <= 0) {
        clearInterval(interval);
        setTasks(prev => [newTask, ...prev]);
        setUndoTask(current => current?.id === newTask.id ? null : current);
        undoCancelRef.current = null;
      }
    }, 1000);

    undoCancelRef.current = (proceed = false) => {
      clearInterval(interval);
      if (proceed) {
        setTasks(prev => [newTask, ...prev]);
      } else {
        setNotification({ message: '已撤销生成任务', type: 'success' });
      }
      setUndoTask(current => current?.id === newTask.id ? null : current);
      undoCancelRef.current = null;
    };
    // ---------------------

    if (!isEdit) setPrompt('');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      (Array.from(files) as File[]).forEach(file => {
        if (referenceImages.length >= 3) return;
        const reader = new FileReader();
        reader.onloadend = () => {
          addReferenceImage(reader.result as string);
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const [brushColor, setBrushColor] = useState<string>('rgba(16, 185, 129, 0.5)');
  const [brushSize, setBrushSize] = useState<number>(30);

  // --- Drawing Logic ---
  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    isDrawing.current = true;
    draw(e);
  };

  const stopDrawing = () => {
    isDrawing.current = false;
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.beginPath();
    }
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    
    // Calculate scale factor between CSS pixels and internal canvas pixels
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const clientX = ('touches' in e) ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = ('touches' in e) ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.strokeStyle = brushColor;

    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const handleEditSubmit = () => {
    if (!editingImage || !prompt.trim()) return;
    
    // In a real scenario, we might merge the mask with the image, 
    // but here we'll just send the original image + prompt as per Gemini's general edit capability
    addTask(true, editingImage.url);
    setEditingImage(null);
  };

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100 font-sans selection:bg-emerald-500/30">
      {/* API Key Modal */}
      <AnimatePresence>
        {showKeyInput && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-xl flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="max-w-md w-full bg-[#111] border border-white/10 rounded-3xl p-8 shadow-2xl"
            >
              <div className="w-12 h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center mb-6">
                <Key className="text-emerald-500 w-6 h-6" />
              </div>
              <h2 className="text-xl font-semibold mb-2">输入 API 密钥</h2>
              <p className="text-zinc-500 text-sm mb-6">请输入您的 Google Gemini API 密钥以开始使用。密钥将保存在本地浏览器中。</p>
              
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="在此粘贴 API 密钥..."
                className="w-full bg-black border border-white/10 rounded-xl p-4 text-sm mb-4 focus:outline-none focus:border-emerald-500/50"
              />
              
              <button
                onClick={handleSaveKey}
                className="w-full py-4 bg-white text-black font-semibold rounded-xl hover:bg-zinc-200 transition-colors"
              >
                保存并继续
              </button>
              
              <p className="mt-4 text-[10px] text-zinc-600 text-center">
                没有密钥？访问 <a href="https://aistudio.google.com/app/apikey" target="_blank" className="text-emerald-500 underline">Google AI Studio</a> 获取。
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Image Modal */}
      <AnimatePresence>
        {selectedImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] bg-black/95 backdrop-blur-md flex items-center justify-center p-4 md:p-12"
            onClick={() => setSelectedImage(null)}
          >
            <button className="absolute top-6 right-6 p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors">
              <X className="w-6 h-6" />
            </button>
            <motion.div 
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="relative max-w-full max-h-full"
              onClick={e => e.stopPropagation()}
            >
              <img 
                src={selectedImage.url} 
                alt="Preview" 
                className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
              />
              <div className="mt-4 flex items-center justify-between bg-black/50 p-4 rounded-2xl backdrop-blur-md border border-white/5">
                <div className="space-y-1">
                  <p className="text-sm font-medium line-clamp-1">{selectedImage.prompt}</p>
                  <div className="flex gap-2 text-[10px] text-zinc-500">
                    <span>{selectedImage.resolution}</span>
                    <span>•</span>
                    <span>{selectedImage.aspectRatio}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setEditingImage(selectedImage)}
                    className="p-2 bg-emerald-500 text-black rounded-lg hover:bg-emerald-400 transition-colors flex items-center gap-2 text-xs font-medium"
                  >
                    <Brush className="w-4 h-4" />
                    编辑此图
                  </button>
                  <a 
                    href={selectedImage.url} 
                    download="generated-image.png"
                    className="p-2 bg-white text-black rounded-lg hover:bg-zinc-200 transition-colors flex items-center gap-2 text-xs font-medium"
                  >
                    <Download className="w-4 h-4" />
                    保存
                  </a>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Editor Modal */}
      <AnimatePresence>
        {editingImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[95] bg-black/95 backdrop-blur-xl flex items-center justify-center p-6"
          >
            <div className="max-w-5xl w-full bg-[#111] border border-white/10 rounded-3xl overflow-hidden flex flex-col h-[90vh]">
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Brush className="text-emerald-500 w-5 h-5" />
                  <h2 className="font-semibold">局部编辑 (Inpainting)</h2>
                </div>
                <button onClick={() => setEditingImage(null)} className="p-2 hover:bg-white/5 rounded-lg">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div ref={editorContainerRef} className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
                <div className="relative inline-block">
                  <img 
                    src={editingImage.url} 
                    alt="To Edit" 
                    className="max-h-[60vh] object-contain select-none"
                    onDragStart={e => e.preventDefault()}
                  />
                  <canvas
                    ref={canvasRef}
                    width={1024} // Fixed high res for mask
                    height={1024}
                    className="absolute inset-0 w-full h-full cursor-crosshair"
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                  />
                </div>
                <motion.div 
                  drag
                  dragConstraints={editorContainerRef}
                  dragMomentum={false}
                  className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-md border border-white/10 rounded-2xl px-4 py-4 flex items-center gap-4 shadow-2xl cursor-default z-50"
                >
                  <div className="cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-400 px-1">
                    <GripVertical className="w-5 h-5" />
                  </div>
                  <div className="w-px h-8 bg-white/5" />
                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] text-zinc-500 uppercase font-bold">画笔颜色</label>
                    <div className="flex gap-2">
                      {[
                        'rgba(16, 185, 129, 0.5)', // Emerald
                        'rgba(59, 130, 246, 0.5)', // Blue
                        'rgba(239, 68, 68, 0.5)',  // Red
                        'rgba(245, 158, 11, 0.5)', // Amber
                        'rgba(255, 255, 255, 0.5)' // White
                      ].map(color => (
                        <button
                          key={color}
                          onClick={() => setBrushColor(color)}
                          className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${brushColor === color ? 'border-white scale-110' : 'border-transparent'}`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="w-px h-10 bg-white/10" />
                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] text-zinc-500 uppercase font-bold">画笔大小</label>
                    <input 
                      type="range" 
                      min="5" 
                      max="100" 
                      value={brushSize} 
                      onChange={(e) => setBrushSize(parseInt(e.target.value))}
                      className="w-24 accent-emerald-500"
                    />
                  </div>
                  <div className="w-px h-10 bg-white/10" />
                  <button 
                    onClick={() => {
                      const ctx = canvasRef.current?.getContext('2d');
                      if (canvasRef.current) {
                        ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
                      }
                    }}
                    className="text-xs text-zinc-500 hover:text-white flex flex-col items-center gap-1 min-w-[40px]"
                  >
                    <Eraser className="w-4 h-4" />
                    重置
                  </button>
                </motion.div>
              </div>

              <div className="p-8 bg-[#161616] border-t border-white/5 space-y-6">
                <div className="flex flex-col md:flex-row gap-8">
                  {/* Aspect Ratio in Editor */}
                  <div className="w-full md:w-64 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                        <Maximize2 className="w-3 h-3" />
                        输出比例
                      </label>
                      <span className="text-[10px] bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded-full font-bold">{aspectRatio}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {(["16:9", "9:16", "1:1", "4:3", "3:4"] as AspectRatio[]).map((ratio) => (
                        <button
                          key={ratio}
                          onClick={() => setAspectRatio(ratio)}
                          className={`flex flex-col items-center gap-2 py-2 rounded-xl border transition-all ${
                            aspectRatio === ratio
                              ? "bg-emerald-500/10 border-emerald-500 text-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.1)]"
                              : "bg-black border-white/10 text-zinc-500 hover:border-white/20"
                          }`}
                        >
                          <div className={`border-2 rounded-sm transition-colors ${aspectRatio === ratio ? 'border-emerald-500' : 'border-zinc-700'}`} 
                            style={{ 
                              width: ratio === '1:1' ? '12px' : ratio === '3:4' ? '9px' : ratio === '4:3' ? '16px' : ratio === '9:16' ? '8px' : '20px',
                              height: ratio === '1:1' ? '12px' : ratio === '3:4' ? '12px' : ratio === '4:3' ? '12px' : ratio === '9:16' ? '14px' : '11px'
                            }} 
                          />
                          <span className="text-[9px] font-bold">{ratio}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Prompt in Editor */}
                  <div className="flex-1 space-y-3">
                    <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">修改指令</label>
                    <div className="flex flex-col gap-3">
                      <div className="flex gap-4">
                        <input
                          type="text"
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value)}
                          onKeyDown={(e) => {
                            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && prompt.trim()) {
                              handleEditSubmit();
                            }
                          }}
                          placeholder="例如：将选中的帽子换成红色的圣诞帽..."
                          className="flex-1 bg-black border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500/50"
                        />
                        <button
                          onClick={handleEditSubmit}
                          className="px-8 bg-emerald-500 text-black font-semibold rounded-xl hover:bg-emerald-400 transition-colors flex items-center gap-2 whitespace-nowrap"
                        >
                          <Save className="w-4 h-4" />
                          提交修改
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="text-[10px] text-zinc-600 font-bold uppercase py-1">常用指令:</span>
                        {[
                          "去掉标注的地方，其它保持不变",
                          "将标注区域替换为",
                          "在标注区域添加",
                          "高清修复并完善细节"
                        ].map(p => (
                          <button
                            key={p}
                            onClick={() => setPrompt(p)}
                            className="px-3 py-1 bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg text-[10px] text-zinc-400 hover:text-zinc-200 transition-all"
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Prompt Drawer */}
      <AnimatePresence>
        {isPromptDrawerOpen && (
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            style={{ width: drawerWidth }}
            className="fixed top-0 right-0 h-full bg-[#0a0a0a] border-l border-white/10 z-[130] shadow-2xl flex flex-col"
          >
            {/* Resize Handle */}
            <div
              onMouseDown={startResizing}
              className="absolute left-0 top-0 w-1 h-full cursor-col-resize hover:bg-emerald-500/50 transition-colors z-[140]"
            />
            
            <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                    <History className="w-4 h-4 text-emerald-500" />
                  </div>
                  <h2 className="text-lg font-bold text-white">提示词库</h2>
                </div>
                <button 
                  onClick={() => setIsPromptDrawerOpen(false)}
                  className="p-2 hover:bg-white/5 rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
                {/* Add New/Edit Preset Form */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
                      {editingPresetId ? '编辑预设' : '新增预设'}
                    </h3>
                    {!isAddingPreset && (
                      <button
                        onClick={() => setIsAddingPreset(true)}
                        className="p-1.5 hover:bg-white/5 rounded-lg transition-colors text-emerald-500 flex items-center gap-1 text-xs font-bold"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        新建
                      </button>
                    )}
                  </div>
                  
                  <AnimatePresence>
                    {isAddingPreset && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-3 bg-white/5 p-4 rounded-2xl border border-white/5 mb-4">
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="text"
                              value={newPresetTitle}
                              onChange={(e) => setNewPresetTitle(e.target.value)}
                              placeholder="预设名称"
                              className="bg-black border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500/50"
                            />
                            <select
                              value={newPresetCategory}
                              onChange={(e) => setNewPresetCategory(e.target.value)}
                              className="bg-black border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/50 text-zinc-400"
                            >
                              {PROMPT_CATEGORIES.map(cat => (
                                <option key={cat} value={cat}>{cat}</option>
                              ))}
                            </select>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-zinc-500 font-bold uppercase">比例设置:</span>
                            <div className="flex gap-1 overflow-x-auto pb-1 no-scrollbar">
                              {['default', '1:1', '3:4', '4:3', '9:16', '16:9'].map(ratio => (
                                <button
                                  key={ratio}
                                  onClick={() => setNewPresetAspectRatio(ratio as any)}
                                  className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all whitespace-nowrap ${
                                    newPresetAspectRatio === ratio 
                                      ? 'bg-emerald-500 text-black' 
                                      : 'bg-black border border-white/10 text-zinc-500 hover:border-emerald-500/30'
                                  }`}
                                >
                                  {ratio === 'default' ? '默认' : ratio}
                                </button>
                              ))}
                            </div>
                          </div>
                          <textarea
                            value={newPresetContent}
                            onChange={(e) => setNewPresetContent(e.target.value)}
                            placeholder="提示词内容..."
                            rows={2}
                            className="w-full bg-black border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500/50 resize-none"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setIsAddingPreset(false);
                                setEditingPresetId(null);
                                setNewPresetTitle('');
                                setNewPresetContent('');
                              }}
                              className="flex-1 py-2 bg-white/5 text-zinc-400 rounded-xl font-bold text-sm hover:bg-white/10 transition-all"
                            >
                              取消
                            </button>
                            <button
                              onClick={addPromptPreset}
                              className="flex-[2] py-2 bg-emerald-500 text-black rounded-xl font-bold text-sm hover:bg-emerald-400 transition-all flex items-center justify-center gap-2"
                            >
                              <Save className="w-4 h-4" />
                              {editingPresetId ? '更新预设' : '保存'}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Presets List */}
                <div className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">我的预设 ({promptPresets.length})</h3>
                      {promptPresets.some(p => p.isSystem) && (
                        <button 
                          onClick={restoreAllDefaults}
                          className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors flex items-center gap-1"
                        >
                          <RefreshCw className="w-2.5 h-2.5" />
                          重置所有系统预设
                        </button>
                      )}
                    </div>
                    
                    {/* Category Filter */}
                    <div className="flex flex-wrap gap-1.5">
                      {['全部', ...PROMPT_CATEGORIES].map(cat => (
                        <button
                          key={cat}
                          onClick={() => setSelectedCategory(cat)}
                          className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${
                            selectedCategory === cat 
                              ? 'bg-emerald-500 text-black' 
                              : 'bg-white/5 text-zinc-500 hover:bg-white/10'
                          }`}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {promptPresets.filter(p => selectedCategory === '全部' || p.category === selectedCategory).length === 0 ? (
                      <div className="text-center py-12 border border-dashed border-white/5 rounded-2xl">
                        <History className="w-8 h-8 text-zinc-800 mx-auto mb-3" />
                        <p className="text-sm text-zinc-600">暂无该分类下的提示词</p>
                      </div>
                    ) : (
                      promptPresets
                        .filter(p => selectedCategory === '全部' || p.category === selectedCategory)
                        .map(preset => (
                          <motion.div
                            key={preset.id}
                            layout
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="group bg-white/5 border border-white/5 rounded-xl p-3 hover:border-emerald-500/30 transition-all cursor-pointer relative overflow-hidden"
                            onClick={() => usePromptPreset(preset)}
                          >
                            <div className="flex items-center justify-between mb-1 gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase whitespace-nowrap flex-shrink-0 ${
                                  preset.isSystem ? 'bg-blue-500/10 text-blue-500/70' : 'bg-emerald-500/10 text-emerald-500/70'
                                }`}>
                                  {preset.category || '其他'}
                                </span>
                                <h4 className="font-bold text-xs text-zinc-200 group-hover:text-emerald-400 transition-colors truncate">
                                  {preset.title}
                                </h4>
                                {preset.preferredAspectRatio && preset.preferredAspectRatio !== 'default' && (
                                  <span className="text-[8px] bg-zinc-800 text-zinc-400 px-1 rounded font-mono flex-shrink-0">{preset.preferredAspectRatio}</span>
                                )}
                                {preset.isSystem && (
                                  <span className="text-[8px] text-zinc-600 border border-zinc-800 px-1 rounded flex-shrink-0">系统</span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copyPromptPreset(preset);
                                  }}
                                  className="p-1 opacity-0 group-hover:opacity-100 hover:bg-white/10 rounded transition-all"
                                  title="复制标题和内容"
                                >
                                  <Copy className="w-3 h-3 text-zinc-400" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startEditingPreset(preset);
                                  }}
                                  className="p-1 opacity-0 group-hover:opacity-100 hover:bg-white/10 rounded transition-all"
                                  title="编辑"
                                >
                                  <Edit2 className="w-3 h-3 text-zinc-400" />
                                </button>
                                {preset.isSystem && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      restoreSystemPreset(preset.id);
                                    }}
                                    className="p-1 opacity-0 group-hover:opacity-100 hover:bg-white/10 rounded transition-all"
                                    title="恢复默认"
                                  >
                                    <RefreshCw className="w-3 h-3 text-zinc-400" />
                                  </button>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deletePromptPreset(preset.id);
                                  }}
                                  className="p-1 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 rounded transition-all"
                                  title="删除"
                                >
                                  <Trash2 className="w-3 h-3 text-red-400" />
                                </button>
                              </div>
                            </div>
                            <p className="text-[10px] text-zinc-500 line-clamp-1 leading-relaxed pr-8">
                              {preset.content}
                            </p>
                            <div className="absolute right-3 bottom-3 opacity-0 group-hover:opacity-100 transition-opacity">
                              <RefreshCw className="w-3 h-3 text-emerald-500/40" />
                            </div>
                          </motion.div>
                        ))
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Progress Indicator */}
      <AnimatePresence>
        {tasks.some(t => t.status !== 'completed' && t.status !== 'failed') && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-6 right-6 z-[80] bg-black/80 backdrop-blur-xl border border-emerald-500/30 p-4 rounded-2xl shadow-2xl flex items-center gap-4 min-w-[280px]"
          >
            <div className="w-10 h-10 bg-emerald-500/10 rounded-full flex items-center justify-center relative">
              <Loader2 className="w-5 h-5 text-emerald-500 animate-spin" />
              <div className="absolute -top-1 -right-1 bg-emerald-500 text-black text-[8px] font-bold px-1.5 py-0.5 rounded-full">
                {tasks.filter(t => t.status !== 'completed' && t.status !== 'failed').length}
              </div>
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold text-white mb-1">正在生成中...</p>
              <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-emerald-500"
                  animate={{ 
                    width: `${(tasks.reduce((acc, t) => acc + (t.status === 'completed' ? t.total : t.progress), 0) / tasks.reduce((acc, t) => acc + t.total, 0)) * 100}%` 
                  }}
                />
              </div>
            </div>
            <button 
              onClick={() => {
                const queueEl = document.getElementById('task-queue');
                queueEl?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="p-2 hover:bg-white/5 rounded-lg text-zinc-400"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Notification Toast */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className={`fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 rounded-full shadow-2xl z-[100] flex items-center gap-3 border ${
              notification.type === 'error' ? 'bg-red-500 border-red-400 text-white' : 'bg-emerald-500 border-emerald-400 text-black'
            }`}
          >
            {notification.type === 'error' ? <AlertCircle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
            <span className="text-sm font-bold">{notification.message}</span>
            <button onClick={() => setNotification(null)} className="ml-2 hover:opacity-70">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[110] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-zinc-900 border border-white/10 p-8 rounded-3xl max-w-md w-full shadow-2xl"
            >
              <h3 className="text-xl font-bold text-white mb-4">确认操作</h3>
              <p className="text-zinc-400 mb-8 leading-relaxed">{confirmModal.message}</p>
              <div className="flex gap-4">
                <button
                  onClick={() => setConfirmModal(null)}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl font-bold transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    confirmModal.onConfirm();
                    setConfirmModal(null);
                  }}
                  className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-bold transition-colors"
                >
                  确认
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Undo Notification */}
      <AnimatePresence>
        {undoTask && (
          <motion.div
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-[200] bg-zinc-900 border border-white/10 rounded-2xl px-6 py-4 shadow-2xl flex items-center gap-6 min-w-[320px]"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">即将开始生成</p>
                <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">比例: {undoTask.aspectRatio} • {undoCountdown}s 后开始</p>
              </div>
            </div>
            <button
              onClick={() => undoCancelRef.current?.()}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold text-white transition-all flex items-center gap-2"
            >
              <RefreshCw className="w-3 h-3" />
              撤销
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="border-b border-white/5 bg-black/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
              <ImageIcon className="text-black w-5 h-5" />
            </div>
            <h1 className="font-semibold tracking-tight">NanoBananaPro <span className="text-zinc-500 font-normal">Studio</span></h1>
          </div>
          <div className="flex items-center gap-4">
            {!hasPlatformKey && !apiKey && (
              <button 
                onClick={handleOpenSelectKey}
                className="hidden md:flex items-center gap-2 px-4 py-2 bg-emerald-500 text-black rounded-full text-xs font-bold hover:bg-emerald-400 transition-colors"
              >
                <Key className="w-4 h-4" />
                激活 Pro 模型
              </button>
            )}
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-full border border-white/5">
              <div className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-700'}`} />
              <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-widest">
                {isProcessing ? '正在处理队列' : '队列空闲'}
              </span>
            </div>
            <button 
              onClick={() => setIsPromptDrawerOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full transition-all relative group"
            >
              <Library className="w-4 h-4 text-emerald-500 group-hover:scale-110 transition-transform" />
              <span className="text-xs font-bold text-zinc-300">预设提示词</span>
              {promptPresets.length > 0 && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-black" />
              )}
            </button>
            <button 
              onClick={() => setShowKeyInput(true)}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full transition-all group"
              title="设置 API 密钥"
            >
              <Key className="w-4 h-4 text-zinc-400 group-hover:text-emerald-500 transition-colors" />
              <span className="text-xs font-bold text-zinc-300">API 设置</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 md:px-8 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Sidebar Controls */}
        <aside className="lg:col-span-3 xl:col-span-3 space-y-6">
          <section className="bg-[#111] border border-white/5 rounded-2xl p-6 space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Type className="w-3 h-3" />
                  提示词 (Prompt)
                </div>
                <button
                  onClick={() => setIsPromptDrawerOpen(!isPromptDrawerOpen)}
                  className="flex items-center gap-1.5 px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-all text-[10px] font-bold text-zinc-400 hover:text-emerald-500 group/preset"
                >
                  <Library className="w-3 h-3 group-hover/preset:scale-110 transition-transform" />
                  预设提示词
                </button>
              </label>
              <div className="relative group/prompt">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && prompt.trim()) {
                      addTask();
                      setNotification({ message: '任务已添加到队列', type: 'success' });
                    }
                  }}
                  placeholder="描述你想要生成的画面..."
                  className="w-full h-28 bg-black border border-white/10 rounded-xl p-4 pr-12 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors resize-none placeholder:text-zinc-700"
                />
                <button
                  onClick={() => {
                    addTask();
                    setNotification({ message: '任务已添加到队列', type: 'success' });
                  }}
                  disabled={!prompt.trim()}
                  className="absolute bottom-3 right-3 px-2 py-1.5 bg-emerald-500 text-black rounded-lg hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-0 disabled:pointer-events-none shadow-lg shadow-emerald-500/20 flex items-center gap-2"
                  title="按下 Ctrl + Enter 立即生成"
                >
                  <div className="flex items-center gap-1 opacity-80">
                    <kbd className="text-[9px] font-bold bg-black/10 px-1 rounded border border-black/10">Ctrl</kbd>
                    <span className="text-[9px] font-bold">+</span>
                    <kbd className="text-[9px] font-bold bg-black/10 px-1 rounded border border-black/10">↵</kbd>
                  </div>
                  <span className="text-[10px] font-bold border-l border-black/10 pl-2">生成</span>
                </button>
              </div>
              {referenceImages.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {referenceImages.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setPrompt(prev => prev.trim() + ` @图${index + 1} `)}
                      className="px-2 py-1 bg-white/5 border border-white/10 rounded text-[10px] text-zinc-400 hover:bg-emerald-500/20 hover:text-emerald-400 transition-colors flex items-center gap-1"
                    >
                      <ImageIcon className="w-3 h-3" />
                      引用图 {index + 1}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                <Upload className="w-3 h-3" />
                参考图 (最多3张)
              </label>
              <div className="grid grid-cols-3 gap-3">
                {referenceImages.map((img, index) => (
                  <div key={img.id} className="relative aspect-square rounded-xl overflow-hidden border border-white/10 group/ref">
                    <img src={img.url} alt={`Ref ${index + 1}`} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/ref:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                      <button 
                        onClick={() => setEditingImage({ url: img.url })}
                        className="p-1.5 bg-emerald-500 text-black rounded-lg hover:bg-emerald-400 transition-colors"
                        title="编辑"
                      >
                        <Brush className="w-3.5 h-3.5" />
                      </button>
                      <button 
                        onClick={() => removeReferenceImage(img.id)}
                        className="p-1.5 bg-red-500 text-white rounded-lg hover:bg-red-400 transition-colors"
                        title="移除"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/60 backdrop-blur-md rounded text-[8px] text-white font-bold border border-white/10">
                      图 {index + 1}
                    </div>
                  </div>
                ))}
                {referenceImages.length < 3 && (
                  <label className="flex flex-col items-center justify-center aspect-square border border-dashed border-white/10 rounded-xl cursor-pointer hover:bg-white/5 transition-colors group">
                    <Plus className="w-5 h-5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                    <input type="file" accept="image/*" className="hidden" multiple onChange={handleFileUpload} />
                  </label>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                    <Maximize2 className="w-3 h-3" />
                    生成比例 (Aspect Ratio)
                  </label>
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded-full font-bold">{aspectRatio}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(["16:9", "9:16", "1:1", "4:3", "3:4"] as AspectRatio[]).map((ratio) => (
                    <button
                      key={ratio}
                      onClick={() => setAspectRatio(ratio)}
                      className={`flex flex-col items-center gap-2 p-2.5 rounded-xl border transition-all ${
                        aspectRatio === ratio
                          ? "bg-emerald-500/10 border-emerald-500 text-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.1)]"
                          : "bg-black border-white/10 text-zinc-500 hover:border-white/20"
                      }`}
                    >
                      <div className={`border-2 rounded-sm transition-colors ${aspectRatio === ratio ? 'border-emerald-500' : 'border-zinc-700'}`} 
                        style={{ 
                          width: ratio === '1:1' ? '14px' : ratio === '3:4' ? '10px' : ratio === '4:3' ? '18px' : ratio === '9:16' ? '9px' : '22px',
                          height: ratio === '1:1' ? '14px' : ratio === '3:4' ? '14px' : ratio === '4:3' ? '13px' : ratio === '9:16' ? '16px' : '12px'
                        }} 
                      />
                      <span className="text-[10px] font-bold">{ratio}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                  <Hash className="w-3 h-3" />
                  生成数量 (Count)
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={count}
                    onChange={(e) => setCount(parseInt(e.target.value))}
                    className="flex-1 accent-emerald-500"
                  />
                  <span className="w-12 text-center bg-black border border-white/10 rounded-lg py-1 text-sm font-bold text-emerald-500">
                    {count}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                <Layers className="w-3 h-3" />
                分辨率 (Resolution)
              </label>
              <div className="flex flex-wrap gap-2">
                {(["1K", "2K", "4K"] as Resolution[]).map((res) => (
                  <button
                    key={res}
                    onClick={() => setSelectedResolutions([res])}
                    className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                      selectedResolutions.includes(res)
                        ? "bg-emerald-500 text-black shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                        : "bg-black border border-white/10 text-zinc-400 hover:border-white/20"
                    }`}
                  >
                    {res}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => {
                addTask();
                setNotification({ message: '任务已添加到队列', type: 'success' });
              }}
              className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg ${
                isAddingToQueue 
                  ? 'bg-emerald-600 text-white scale-[0.98]' 
                  : 'bg-emerald-500 text-black hover:bg-emerald-400 shadow-emerald-500/20'
              }`}
            >
              {isAddingToQueue ? (
                <>
                  <CheckCircle2 className="w-5 h-5" />
                  已添加到队列
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  立即生成图片
                </>
              )}
            </button>
          </section>

          {/* Task Queue Section */}
          <section id="task-queue" className={`bg-[#111] border rounded-2xl p-6 space-y-4 transition-all duration-500 ${
            tasks.some(t => t.status === 'running') ? 'border-emerald-500/30 shadow-[0_0_30px_rgba(16,185,129,0.05)]' : 'border-white/5'
          }`}>
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest flex items-center justify-between">
              任务队列
              <span className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                tasks.some(t => t.status === 'running') ? 'bg-emerald-500 text-black font-bold' : 'bg-white/5 text-zinc-400'
              }`}>
                {tasks.filter(t => t.status !== 'completed').length}
              </span>
            </h3>
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              <AnimatePresence initial={false}>
                {tasks.length === 0 ? (
                  <p className="text-[10px] text-zinc-600 text-center py-4 italic">暂无待处理任务</p>
                ) : (
                  tasks.map(task => (
                    <motion.div 
                      key={task.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      className={`p-3 rounded-xl border ${
                        task.status === 'running' ? 'bg-emerald-500/5 border-emerald-500/20' : 
                        task.status === 'failed' ? 'bg-red-500/5 border-red-500/20' : 
                        'bg-black border-white/5'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] font-medium text-zinc-300 truncate max-w-[150px]">{task.prompt || '编辑任务'}</p>
                        <div className="flex items-center gap-2">
                          {task.status === 'running' && <Loader2 className="w-3 h-3 text-emerald-500 animate-spin" />}
                          {task.status === 'completed' && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
                          {task.status === 'failed' && (
                            <button 
                              onClick={() => retryTask(task.id)}
                              className="p-1 hover:bg-white/10 rounded transition-colors"
                              title="重试"
                            >
                              <RefreshCw className="w-3 h-3 text-red-400" />
                            </button>
                          )}
                          <button 
                            onClick={() => deleteTask(task.id)}
                            className="p-1 hover:bg-white/10 rounded transition-colors"
                            title="删除"
                          >
                            <Trash2 className="w-3 h-3 text-zinc-600 hover:text-red-400" />
                          </button>
                        </div>
                      </div>
                      {task.status === 'failed' && task.error && (
                        <p className="text-[8px] text-red-400/80 mb-2 line-clamp-1">{task.error}</p>
                      )}
                      <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${(task.progress / task.total) * 100}%` }}
                          className={`h-full ${task.status === 'failed' ? 'bg-red-500' : 'bg-emerald-500'}`}
                        />
                      </div>
                      <div className="flex justify-between mt-1.5">
                        <span className="text-[9px] text-zinc-500 uppercase">{task.status}</span>
                        <span className="text-[9px] text-zinc-500 font-mono">{task.progress}/{task.total}</span>
                      </div>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>
          </section>
        </aside>

        {/* Results Grid */}
        <div className="lg:col-span-9 xl:col-span-9">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-medium flex items-center gap-2">
              生成历史
              <span className="text-xs font-normal text-zinc-500 bg-white/5 px-2 py-0.5 rounded-full">
                {results.length}
              </span>
            </h2>
            {results.length > 0 && (
              <button 
                onClick={clearAllHistory}
                className="text-xs text-zinc-500 hover:text-red-400 transition-colors flex items-center gap-1"
              >
                <History className="w-3 h-3" />
                清空历史
              </button>
            )}
          </div>

          {results.length === 0 ? (
            <div className="h-[60vh] border border-dashed border-white/10 rounded-3xl flex flex-col items-center justify-center text-zinc-600">
              <ImageIcon className="w-12 h-12 mb-4 opacity-20" />
              <p className="text-sm">暂无生成结果，在左侧添加任务开始创作</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
              <AnimatePresence mode="popLayout">
                {results.map((result) => (
                  <motion.div
                    key={result.id}
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="group relative bg-[#111] border border-white/5 rounded-2xl overflow-hidden"
                  >
                    <div className="aspect-square relative overflow-hidden bg-black cursor-zoom-in" onClick={() => setSelectedImage(result)}>
                      <img
                        src={result.url}
                        alt={result.prompt}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-contain transition-transform duration-700 group-hover:scale-105"
                      />
                      {result.isEdit && (
                        <div className="absolute top-3 left-3 px-2 py-1 bg-emerald-500 text-black text-[9px] font-bold rounded uppercase tracking-widest">
                          Edited
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedImage(result); }}
                          className="p-3 bg-white text-black rounded-full hover:scale-110 transition-transform"
                        >
                          <Maximize2 className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); setEditingImage(result); }}
                          className="p-3 bg-emerald-500 text-black rounded-full hover:scale-110 transition-transform"
                          title="编辑图片"
                        >
                          <Brush className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); addReferenceImage(result.url); }}
                          className="p-3 bg-blue-500 text-white rounded-full hover:scale-110 transition-transform"
                          title="设为参考图"
                        >
                          <Layers className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); deleteSingleResult(result.id); }}
                          className="p-3 bg-red-500 text-white rounded-full hover:scale-110 transition-transform"
                          title="删除图片"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                    
                    <div className="p-4 space-y-2">
                      <p className="text-xs text-zinc-300 line-clamp-2 font-medium leading-relaxed">
                        {result.prompt || '编辑后的图片'}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] px-2 py-0.5 bg-white/5 rounded text-zinc-500 font-mono">
                          {result.resolution}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 bg-white/5 rounded text-zinc-500 font-mono">
                          {result.aspectRatio}
                        </span>
                        <span className="text-[10px] text-zinc-600 ml-auto flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {new Date(result.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-white/5 mt-12">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 text-zinc-600 text-xs">
          <p>© 2026 NanoBananaPro Studio. Powered by Gemini 3 Pro Image.</p>
          <div className="flex items-center gap-6">
            <a href="#" className="hover:text-zinc-400 transition-colors">隐私政策</a>
            <a href="#" className="hover:text-zinc-400 transition-colors">使用条款</a>
            <a href="#" className="hover:text-zinc-400 transition-colors">API 文档</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
