import { useEffect, useMemo, useRef, useState } from 'react'
import PocketBase from 'pocketbase'
import { Home, Paperclip, Send, Smile, Copy, Check } from 'lucide-react'

type Sender = 'student' | 'teacher'

type Message = {
  id: string
  conversationId: string
  sender: Sender
  content: string
  created: string
}

type Conversation = {
  id: string
  studentName?: string
  isAnonymous: boolean
  studentCode?: string
  teacherId?: string
}

type Teacher = {
  id: string
  name?: string
  email?: string
}

const POCKETBASE_URL = import.meta.env.VITE_PB_URL || 'http://localhost:8090'

export default function StudentChat() {
  const pb = useMemo(() => new PocketBase(POCKETBASE_URL), [])

  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [studentName, setStudentName] = useState('')
  const [studentCode, setStudentCode] = useState('')
  const [resumeCode, setResumeCode] = useState('')
  const [resumeError, setResumeError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [newMessageInActiveChat, setNewMessageInActiveChat] = useState(false)
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean
    x: number
    y: number
    message: Message | null
  }>({
    visible: false,
    x: 0,
    y: 0,
    message: null
  })

  // mode pilihan (anonim / pakai nama)
  const [mode, setMode] = useState<'anon' | 'named' | null>(null)

  // teacher selection
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('')
  const [activeTeacher, setActiveTeacher] = useState<Teacher | null>(null)

  const listRef = useRef<HTMLDivElement | null>(null)

  const [nowTs, setNowTs] = useState<number>(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])


  // Format waktu dengan hari dan tanggal untuk pesan lama
  function formatMessageTime(date: Date): string {
    const now = new Date()
    const messageDate = new Date(date)
    
    // Set timezone ke Indonesia
    const nowIndonesia = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Jakarta"}))
    const messageIndonesia = new Date(messageDate.toLocaleString("en-US", {timeZone: "Asia/Jakarta"}))
    
    // Hitung perbedaan hari
    const today = new Date(nowIndonesia.getFullYear(), nowIndonesia.getMonth(), nowIndonesia.getDate())
    const messageDay = new Date(messageIndonesia.getFullYear(), messageIndonesia.getMonth(), messageIndonesia.getDate())
    
    const diffDays = Math.floor((today.getTime() - messageDay.getTime()) / (1000 * 60 * 60 * 24))
    
    if (diffDays === 0) {
      // Hari ini - tampilkan "hari ini" dan jam
      const time = messageIndonesia.toLocaleTimeString('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
      return `Hari ini, ${time}`
    } else if (diffDays === 1) {
      // Kemarin - tampilkan "Kemarin" dan jam
      const time = messageIndonesia.toLocaleTimeString('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
      return `Kemarin, ${time}`
    } else {
      // Lebih dari kemarin - tampilkan tanggal
      return messageIndonesia.toLocaleDateString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      })
    }
  }

  // Format waktu lengkap untuk context menu
  function formatFullTime(date: Date): string {
    return date.toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
  }

  const lastTeacherMsgAt = useMemo(() => {
    if (!conversation) return null
    let latest: number | null = null
    for (const m of messages) {
      if (m.conversationId === conversation.id && m.sender === 'teacher') {
        const ts = new Date(m.created).getTime()
        if (latest == null || ts > latest) latest = ts
      }
    }
    return latest
  }, [messages, conversation?.id])

  const isTeacherOnline = useMemo(() => {
    if (!lastTeacherMsgAt) return false
    return nowTs - lastTeacherMsgAt < 2 * 60 * 1000
  }, [nowTs, lastTeacherMsgAt])

  function generateReadableCode(length: number = 6): string {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
    let result = ''
    for (let i = 0; i < length; i++) {
      const idx = Math.floor(Math.random() * alphabet.length)
      result += alphabet[idx]
    }
    return `${result.slice(0, 3)}-${result.slice(3)}`
  }

  async function ensureUniqueStudentCode(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = generateReadableCode(6)
      try {
        await pb.collection('conversations').getFirstListItem<Conversation>(
          `studentCode = "${code}"`
        )
        // collision, try again
      } catch {
        return code
      }
    }
    const fallback = crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()
    return `${fallback.slice(0, 3)}-${fallback.slice(3)}`
  }

  // restore existing conversation from localStorage
  useEffect(() => {
    const savedConversationId = localStorage.getItem('conversationId')
    if (!savedConversationId) return
    ;(async () => {
      try {
        const conv = await pb.collection('conversations').getOne<Conversation>(savedConversationId)
        setConversation(conv)
        if (conv.studentCode) setStudentCode(conv.studentCode)
        if (conv.studentName) setStudentName(conv.studentName)
        if (conv.teacherId) {
          try {
            const t = await pb.collection('teachers').getOne<Teacher>(conv.teacherId)
            setActiveTeacher(t)
          } catch {}
        }
      } catch {
        localStorage.removeItem('conversationId')
      }
    })()
  }, [pb])

  // load available teachers
  useEffect(() => {
    ;(async () => {
      try {
        const list = await pb.collection('teachers').getFullList<Teacher>({ sort: 'name' })
        setTeachers(list)
      } catch {
        setTeachers([])
      }
    })()
  }, [pb])

  // sync active teacher
  useEffect(() => {
    if (!selectedTeacherId) return
    const t = teachers.find(x => x.id === selectedTeacherId) || null
    setActiveTeacher(t)
  }, [selectedTeacherId, teachers])

  // load messages + subscribe realtime
  useEffect(() => {
    if (!conversation?.id) return
    let unsub: (() => void) | undefined
    ;(async () => {
      const list = await pb
        .collection('messages')
        .getFullList<Message>({
          filter: `conversationId = "${conversation.id}"`,
          sort: 'created',
        })
      setMessages(list)
      unsub = await pb.collection('messages').subscribe<Message>(
        '*',
        (e: any) => {
          const rec = e.record as Message
          if (rec.conversationId === conversation.id) {
            setMessages(prev => {
              // Check if message already exists to prevent duplicates
              const exists = prev.some(m => m.id === rec.id)
              if (exists) return prev
              return [...prev, rec]
            })
            // Tampilkan indikator pesan baru jika dari guru
            if (rec.sender === 'teacher') {
              setNewMessageInActiveChat(true)
            }
          }
        },
        { filter: `conversationId = "${conversation.id}"` }
      )
    })()
    return () => {
      if (unsub) unsub()
    }
  }, [pb, conversation?.id])

  // Reset indikator pesan baru ketika conversation berubah
  useEffect(() => {
    setNewMessageInActiveChat(false)
  }, [conversation?.id])

  // Handle context menu
  function handleMessageContextMenu(e: React.MouseEvent, message: Message) {
    e.preventDefault()
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      message
    })
  }

  // Close context menu when clicking outside
  useEffect(() => {
    function handleClickOutside() {
      setContextMenu(prev => ({ ...prev, visible: false }))
    }

    if (contextMenu.visible) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [contextMenu.visible])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length])

  async function startConversation(selectedMode: 'anon' | 'named'): Promise<Conversation> {
    const payload: Partial<Conversation> = {
      isAnonymous: selectedMode === 'anon',
    }
    if (selectedMode === 'named') {
      const nm = studentName.trim()
      if (!nm) throw new Error('Nama wajib diisi')
      payload.studentName = nm
    }
    payload.studentCode = await ensureUniqueStudentCode()
    if (selectedTeacherId) {
      payload.teacherId = selectedTeacherId
    }
    const conv = await pb.collection('conversations').create<Conversation>(payload)
    setConversation(conv)
    localStorage.setItem('conversationId', conv.id)
    if (conv.studentCode) setStudentCode(conv.studentCode)
    try {
      const teacherName = activeTeacher?.name || activeTeacher?.email || 'Guru'
      await pb.collection('messages').create({
        conversationId: conv.id,
        sender: 'teacher',
        content: `Kamu terhubung dengan "${teacherName}"`,
      })
    } catch {}
    return conv
  }

  async function sendMessage() {
    if (!input.trim()) return
    try {
      let convId = conversation?.id || localStorage.getItem('conversationId') || ''
      if (!convId) {
        const conv = await startConversation('anon')
        convId = conv.id
      }
      await pb.collection('messages').create({
        conversationId: convId,
        sender: 'student',
        content: input.trim(),
      })
      setInput('')
    } catch (error) {
      console.error('Failed to send message', error)
      alert('Gagal mengirim pesan. Coba lagi.')
    }
  }

  async function resumeConversationByCode() {
    const code = resumeCode.trim().toUpperCase()
    if (!code) return
    try {
      setResumeError(null)
      const conv = await pb
        .collection('conversations')
        .getFirstListItem<Conversation>(`studentCode = "${code}"`)
      setConversation(conv)
      localStorage.setItem('conversationId', conv.id)
      if (conv.studentCode) setStudentCode(conv.studentCode)
      if (conv.studentName) setStudentName(conv.studentName)
      if (conv.teacherId) {
        try {
          const t = await pb.collection('teachers').getOne<Teacher>(conv.teacherId)
          setActiveTeacher(t)
        } catch {}
      }
    } catch (e: any) {
      setResumeError('Kode tidak ditemukan')
    }
  }

  function resetConversation() {
    setConversation(null)
    setMessages([])
    setStudentCode('')
    localStorage.removeItem('conversationId')
  }

  function copyStudentCode() {
    if (!studentCode) return
    navigator.clipboard.writeText(studentCode).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  // ============================
  // Bagian Konsultasi Siswa
  // ============================
  if (!conversation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-emerald-50 to-sky-50 p-4 md:p-6">
        <div className="w-full max-w-md bg-white rounded-2xl md:rounded-3xl shadow-lg p-4 md:p-6 space-y-4 md:space-y-6">
          <div className="text-center space-y-3">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-500 rounded-2xl mb-2 shadow-md">
              <img src="/logo.png" alt="Logo Sekolah" className="w-12 h-12 object-contain" />
            </div>
            <div>
              <h1 className="text-sm font-medium text-emerald-600 uppercase tracking-wide">Bimbingan Konseling</h1>
              <div className="w-12 h-0.5 bg-gradient-to-r from-emerald-400 to-emerald-600 mx-auto mt-2 rounded-full"></div>
            </div>
          </div>

          {/* Pilih mode */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-slate-700">Pilih Mode</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                className={`py-3 rounded-xl font-semibold border-2 ${
                  mode === 'anon'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-emerald-600 border-emerald-600 hover:bg-emerald-50'
                }`}
                onClick={() => {
                  setMode('anon')
                }}
              >
                Anonim
              </button>
              <button
                className={`py-3 rounded-xl font-semibold border-2 ${
                  mode === 'named'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-emerald-600 border-emerald-600 hover:bg-emerald-50'
                }`}
                onClick={() => setMode('named')}
              >
                Pakai Nama
              </button>
            </div>
          </div>

          {/* Input nama */}
          <div className={`${mode === 'anon' ? 'opacity-50' : ''}`}>
            <label className={`text-sm ${mode === 'anon' ? 'text-slate-400' : 'text-slate-700'}`}>
              Nama {mode === 'anon' && '(Tidak digunakan dalam mode anonim)'}
            </label>
            <input
              value={studentName}
              onChange={e => setStudentName(e.target.value)}
              placeholder={mode === 'anon' ? 'Mode anonim - nama tidak diperlukan' : 'Masukkan nama Anda'}
              disabled={mode === 'anon'}
              className={`w-full rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-400 border-0 placeholder:text-slate-500 ${
                mode === 'anon' 
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                  : 'bg-slate-100'
              }`}
            />
          </div>

          {/* Pilih Guru */}
          <div className="space-y-2">
            <label className="text-sm text-slate-700">Pilih Guru BK</label>
            <select
              className="w-full bg-slate-100 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-400 border-0 text-sm"
              value={selectedTeacherId}
              onChange={e => setSelectedTeacherId(e.target.value)}
            >
              <option value="">-- Pilih Guru --</option>
              {teachers.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name || t.email || t.id}
                </option>
              ))}
            </select>
          </div>

          {/* Tombol mulai */}
          <button
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl py-3 font-semibold disabled:opacity-60"
            onClick={() => startConversation(mode || 'anon')}
            disabled={!selectedTeacherId || (mode === 'named' && !studentName.trim()) || !mode}
          >
            {!mode ? 'Pilih Mode Terlebih Dahulu' : 'Mulai Konsultasi'}
          </button>
          
          {/* Notifikasi mode wajib */}
          {!mode && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 bg-rose-100 rounded-full flex items-center justify-center">
                  <span className="text-rose-600 text-xs font-bold">!</span>
                </div>
                <p className="text-sm text-rose-700 font-medium">
                  Silakan pilih mode terlebih dahulu (Anonim atau Pakai Nama)
                </p>
              </div>
            </div>
          )}

          {/* Lanjutkan chat */}
          <div className="pt-4 border-t border-slate-100 space-y-2">
            <div className="text-xs text-slate-600">Lanjutkan chat dengan kode sesi</div>
            <div className="flex items-center gap-2">
              <input
                value={resumeCode}
                onChange={e => setResumeCode(e.target.value)}
                placeholder="Masukkan kode sesi"
                className="flex-1 bg-slate-100 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-400 border-0 placeholder:text-slate-500 font-mono"
              />
              <button
                onClick={resumeConversationByCode}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl font-medium disabled:opacity-60"
                disabled={!resumeCode.trim()}
              >
                Lanjutkan
              </button>
            </div>
            {resumeError && <div className="text-xs text-rose-600">{resumeError}</div>}
          </div>

          {/* Info penting */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-5 h-5 bg-amber-100 rounded-full flex items-center justify-center mt-0.5">
                <span className="text-amber-600 text-xs font-bold">!</span>
              </div>
              <div className="text-sm">
                <p className="font-medium text-amber-800 mb-1">Penting!</p>
                <p className="text-amber-700 leading-relaxed">
                  Jangan lupa untuk <strong>menyimpan kode sesi</strong> yang akan diberikan setelah memulai bimbingan. 
                  Kode ini diperlukan untuk melanjutkan konsultasi di lain waktu.
                </p>
              </div>
            </div>
          </div>

          {/* Info kode */}
          {studentCode && (
            <div className="text-xs text-slate-600 text-center">
              Kode sesi Anda: <span className="font-mono">{studentCode}</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ============================
  // Bagian Chat (tidak diubah)
  // ============================
  return (
    <div className="h-screen flex justify-center bg-slate-100">
      <div className="flex w-full max-w-2xl bg-white rounded-lg md:rounded-xl shadow-lg overflow-hidden flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 md:gap-3 px-3 md:px-4 py-3 bg-white shadow-sm">
          <div className="h-8 w-8 md:h-9 md:w-9 rounded-full flex items-center justify-center font-semibold bg-emerald-200 text-emerald-700 text-sm md:text-base">
            {(activeTeacher?.name || activeTeacher?.email || 'G').charAt(0).toUpperCase()}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-xs md:text-sm font-semibold text-slate-800 truncate">
              {`Guru ${activeTeacher?.name || activeTeacher?.email || ''}`.trim() || 'Guru'}
            </span>
            <span className="text-[10px] md:text-xs text-slate-500 flex items-center gap-1 md:gap-2">
              <span
                className={`h-1.5 w-1.5 md:h-2 md:w-2 rounded-full ${
                  isTeacherOnline ? 'bg-emerald-500' : 'bg-slate-400'
                }`}
              />
              {isTeacherOnline ? 'Online' : 'Offline'}
            </span>
          </div>
          <div className="flex items-center gap-1 md:gap-2">
            {studentCode && (
              <div className="hidden md:flex items-center gap-2 text-xs text-slate-600">
                <span className="text-slate-500">Simpan Kode Sesi</span>
                <span className="font-mono bg-slate-100 px-2 py-0.5 rounded select-all">
                  {studentCode}
                </span>
                <button
                  onClick={copyStudentCode}
                  className="inline-flex items-center p-1 rounded hover:bg-slate-100"
                  title="Salin kode"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Copy className="h-4 w-4 text-slate-700" />
                  )}
                </button>
              </div>
            )}
            <button
              onClick={resetConversation}
              className="p-1.5 md:p-2 rounded-full hover:bg-slate-100"
              title="Kembali ke Home"
            >
              <Home className="h-4 w-4 md:h-5 md:w-5 text-slate-700" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-3 md:px-5 py-3 md:py-4 space-y-3 md:space-y-4 bg-slate-50" ref={listRef}>
          {messages.map((m, index) => {
            const d = new Date(m.created)
            const isNewMessage = index === messages.length - 1 && m.sender === 'teacher' && newMessageInActiveChat
            return (
              <div
                key={m.id}
                className={`flex ${m.sender === 'student' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`px-3 md:px-4 py-2 rounded-xl md:rounded-2xl max-w-[85%] md:max-w-[70%] relative ${
                    m.sender === 'student'
                      ? 'bg-emerald-600 text-white rounded-br-md'
                      : 'bg-white text-slate-800 rounded-bl-md shadow-sm'
                  } ${isNewMessage ? 'ring-2 ring-emerald-400 ring-opacity-50' : ''}`}
                  onContextMenu={(e) => handleMessageContextMenu(e, m)}
                >
                  <div className="text-sm md:text-base">{m.content}</div>
                  <div className="text-[9px] md:text-[10px] mt-1 opacity-70 text-right">
                    {formatMessageTime(d)}
                  </div>
                  {isNewMessage && (
                    <div className="absolute -top-1 -right-1 w-2.5 h-2.5 md:w-3 md:h-3 bg-emerald-500 rounded-full animate-pulse"></div>
                  )}
                </div>
              </div>
            )
          })}
          {messages.length === 0 && (
            <div className="text-center text-slate-400 text-xs md:text-sm mt-8 md:mt-10">Belum ada pesan</div>
          )}
        </div>

        {/* Input */}
        <div className="p-3 md:p-4 bg-white shadow-sm">
          <div className="flex items-center gap-1 md:gap-2 bg-slate-100 rounded-full px-2 md:px-3 py-2">
            <button className="p-1.5 md:p-2">
              <Smile className="h-4 w-4 md:h-5 md:w-5 text-slate-600" />
            </button>
            <button className="p-1.5 md:p-2">
              <Paperclip className="h-4 w-4 md:h-5 md:w-5 text-slate-600" />
            </button>
            <textarea
              className="flex-1 bg-transparent resize-none px-1 md:px-2 text-xs md:text-sm focus:outline-none"
              rows={1}
              placeholder="Tulis pesan..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage()
                }
              }}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              className={`p-1.5 md:p-2 rounded-full ${
                input.trim()
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-300 text-white cursor-not-allowed'
              }`}
              title={input.trim() ? 'Kirim' : 'Tulis pesan terlebih dahulu'}
            >
              <Send className="h-4 w-4 md:h-5 md:w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu.visible && contextMenu.message && (
        <div
          className="fixed z-50 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[200px]"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
          }}
        >
          <div className="px-4 py-2 text-sm text-slate-600 border-b border-slate-100">
            <div className="font-medium">Info Pesan</div>
            <div className="text-xs text-slate-500 mt-1">
              {formatFullTime(new Date(contextMenu.message.created))}
            </div>
          </div>
          <button
            className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => {
              navigator.clipboard.writeText(contextMenu.message!.content)
              setContextMenu(prev => ({ ...prev, visible: false }))
            }}
          >
            Salin Teks
          </button>
          <button
            className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => {
              setContextMenu(prev => ({ ...prev, visible: false }))
            }}
          >
            Tutup
          </button>
        </div>
      )}
    </div>
  )
}
