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
  Upload,
  Eraser,
  Brush,
  Save,
  Trash2,
  History,
  Clock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---

type Resolution = "1K" | "2K" | "4K";
type AspectRatio = "1:1" | "3:4" | "4:3" | "9:16" | "16:9";

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
  referenceImage?: string; // base64
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  total: number;
  error?: string;
  isEdit?: boolean;
}

// --- Components ---

const App: React.FC = () => {
  // --- State ---
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem('gemini_api_key') || '');
  const [showKeyInput, setShowKeyInput] = useState<boolean>(!localStorage.getItem('gemini_api_key'));
  
  const [prompt, setPrompt] = useState<string>('');
  const [count, setCount] = useState<number>(1);
  const [selectedResolutions, setSelectedResolutions] = useState<Resolution[]>(["2K"]);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  
  const [tasks, setTasks] = useState<Task[]>([]);
  const [results, setResults] = useState<GenerationResult[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  
  const [selectedImage, setSelectedImage] = useState<GenerationResult | null>(null);
  const [editingImage, setEditingImage] = useState<GenerationResult | null>(null);
  
  // --- Refs ---
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef<boolean>(false);

  // --- Queue Processing ---
  useEffect(() => {
    const processQueue = async () => {
      if (isProcessing) return;
      
      const nextTask = tasks.find(t => t.status === 'pending');
      if (!nextTask) return;

      setIsProcessing(true);
      
      // Update task status to running
      setTasks(prev => prev.map(t => t.id === nextTask.id ? { ...t, status: 'running' } : t));

      try {
        const ai = new GoogleGenAI({ apiKey });
        
        for (const res of nextTask.resolutions) {
          for (let i = 0; i < nextTask.count; i++) {
            const parts: any[] = [{ text: nextTask.prompt }];
            
            if (nextTask.referenceImage) {
              parts.unshift({
                inlineData: {
                  data: nextTask.referenceImage.split(',')[1],
                  mimeType: 'image/png'
                }
              });
            }

            const response = await ai.models.generateContent({
              model: 'gemini-3-pro-image-preview',
              contents: { parts },
              config: {
                imageConfig: {
                  aspectRatio: nextTask.aspectRatio,
                  imageSize: res
                }
              },
            });

            let imageUrl = '';
            for (const part of response.candidates?.[0]?.content?.parts || []) {
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
        console.error("Task error:", err);
        setTasks(prev => prev.map(t => t.id === nextTask.id ? { ...t, status: 'failed', error: err.message } : t));
      } finally {
        setIsProcessing(false);
      }
    };

    processQueue();
  }, [tasks, isProcessing, apiKey]);

  // --- Handlers ---
  const handleSaveKey = () => {
    localStorage.setItem('gemini_api_key', apiKey);
    setShowKeyInput(false);
  };

  const addTask = (isEdit = false, customImage?: string) => {
    if (!prompt.trim() && !isEdit) return;
    if (!apiKey) {
      setShowKeyInput(true);
      return;
    }

    const newTask: Task = {
      id: Math.random().toString(36).substring(7),
      prompt: prompt,
      count: isEdit ? 1 : count,
      resolutions: selectedResolutions,
      aspectRatio: aspectRatio,
      referenceImage: customImage || referenceImage || undefined,
      status: 'pending',
      progress: 0,
      total: (isEdit ? 1 : count) * selectedResolutions.length,
      isEdit
    };

    setTasks(prev => [newTask, ...prev]);
    if (!isEdit) setPrompt('');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setReferenceImage(reader.result as string);
      };
      reader.readAsDataURL(file);
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
              
              <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
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
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-md border border-white/10 rounded-2xl px-6 py-4 flex items-center gap-6">
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
                      ctx?.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
                    }}
                    className="text-xs text-zinc-500 hover:text-white flex flex-col items-center gap-1"
                  >
                    <Eraser className="w-4 h-4" />
                    重置
                  </button>
                </div>
              </div>

              <div className="p-8 bg-[#161616] border-t border-white/5 space-y-4">
                <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">修改指令</label>
                <div className="flex gap-4">
                  <input
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="例如：将选中的帽子换成红色的圣诞帽..."
                    className="flex-1 bg-black border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500/50"
                  />
                  <button
                    onClick={handleEditSubmit}
                    className="px-8 bg-emerald-500 text-black font-semibold rounded-xl hover:bg-emerald-400 transition-colors flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    提交修改
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="border-b border-white/5 bg-black/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
              <ImageIcon className="text-black w-5 h-5" />
            </div>
            <h1 className="font-semibold tracking-tight">NanoBananaPro <span className="text-zinc-500 font-normal">Studio</span></h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-full border border-white/5">
              <div className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-700'}`} />
              <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-widest">
                {isProcessing ? '正在处理队列' : '队列空闲'}
              </span>
            </div>
            <button 
              onClick={() => setShowKeyInput(true)}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors"
              title="设置 API 密钥"
            >
              <Settings2 className="w-5 h-5 text-zinc-400" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Sidebar Controls */}
        <aside className="lg:col-span-4 space-y-6">
          <section className="bg-[#111] border border-white/5 rounded-2xl p-6 space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                <Type className="w-3 h-3" />
                提示词 (Prompt)
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="描述你想要生成的画面..."
                className="w-full h-24 bg-black border border-white/10 rounded-xl p-4 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors resize-none placeholder:text-zinc-700"
              />
            </div>

            <div className="space-y-3">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                <Upload className="w-3 h-3" />
                参考图 (Optional)
              </label>
              <div className="relative group">
                {referenceImage ? (
                  <div className="relative aspect-video rounded-xl overflow-hidden border border-white/10">
                    <img src={referenceImage} alt="Ref" className="w-full h-full object-cover" />
                    <button 
                      onClick={() => setReferenceImage(null)}
                      className="absolute top-2 right-2 p-1.5 bg-black/60 backdrop-blur-md rounded-lg hover:bg-red-500 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center aspect-video border border-dashed border-white/10 rounded-xl cursor-pointer hover:bg-white/5 transition-colors">
                    <Upload className="w-6 h-6 text-zinc-600 mb-2" />
                    <span className="text-[10px] text-zinc-500 uppercase font-medium">点击上传参考图</span>
                    <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                  </label>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">图片数量</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={count}
                  onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full bg-black border border-white/10 rounded-xl p-3 text-sm focus:outline-none focus:border-emerald-500/50"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">比例 (Aspect)</label>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
                  className="w-full bg-black border border-white/10 rounded-xl p-3 text-sm focus:outline-none focus:border-emerald-500/50 appearance-none"
                >
                  <option value="1:1">1:1 (Square)</option>
                  <option value="3:4">3:4 (Portrait)</option>
                  <option value="4:3">4:3 (Landscape)</option>
                  <option value="9:16">9:16 (Vertical)</option>
                  <option value="16:9">16:9 (Wide)</option>
                </select>
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
                    onClick={() => setSelectedResolutions(prev => 
                      prev.includes(res) 
                        ? (prev.length > 1 ? prev.filter(r => r !== res) : prev)
                        : [...prev, res]
                    )}
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
              onClick={() => addTask()}
              className="w-full py-4 bg-white text-black rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-zinc-200 transition-all active:scale-[0.98]"
            >
              <Plus className="w-5 h-5" />
              添加到生成队列
            </button>
          </section>

          {/* Task Queue Section */}
          <section className="bg-[#111] border border-white/5 rounded-2xl p-6 space-y-4">
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest flex items-center justify-between">
              任务队列
              <span className="text-[10px] bg-white/5 px-2 py-0.5 rounded-full">{tasks.filter(t => t.status !== 'completed').length}</span>
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
                          {task.status === 'failed' && <AlertCircle className="w-3 h-3 text-red-500" />}
                          <button 
                            onClick={() => setTasks(prev => prev.filter(t => t.id !== task.id))}
                            className="p-1 hover:bg-white/10 rounded"
                          >
                            <Trash2 className="w-3 h-3 text-zinc-600 hover:text-red-400" />
                          </button>
                        </div>
                      </div>
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
        <div className="lg:col-span-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-medium flex items-center gap-2">
              生成历史
              <span className="text-xs font-normal text-zinc-500 bg-white/5 px-2 py-0.5 rounded-full">
                {results.length}
              </span>
            </h2>
            {results.length > 0 && (
              <button 
                onClick={() => setResults([])}
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                        >
                          <Brush className="w-5 h-5" />
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
