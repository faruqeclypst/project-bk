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

  // Format waktu Indonesia
  function formatIndonesiaTime(date: Date): string {
    return date.toLocaleTimeString('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
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
            setMessages(prev => [...prev, rec])
          }
        },
        { filter: `conversationId = "${conversation.id}"` }
      )
    })()
    return () => {
      if (unsub) unsub()
    }
  }, [pb, conversation?.id])

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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-emerald-50 to-sky-50 p-6">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-lg p-6 space-y-6">
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
      <div className="flex w-full max-w-2xl bg-white rounded-xl shadow-lg overflow-hidden flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-white shadow-sm">
          <div className="h-9 w-9 rounded-full flex items-center justify-center font-semibold bg-emerald-200 text-emerald-700">
            {(activeTeacher?.name || activeTeacher?.email || 'G').charAt(0).toUpperCase()}
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-slate-800 truncate max-w-[200px] block">
              {`Guru ${activeTeacher?.name || activeTeacher?.email || ''}`.trim() || 'Guru'}
            </span>
            <span className="text-xs text-slate-500 flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  isTeacherOnline ? 'bg-emerald-500' : 'bg-slate-400'
                }`}
              />
              {isTeacherOnline ? 'Online' : 'Offline'}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {studentCode && (
              <div className="hidden sm:flex items-center gap-2 text-xs text-slate-600">
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
              className="p-2 rounded-full hover:bg-slate-100"
              title="Kembali ke Home"
            >
              <Home className="h-5 w-5 text-slate-700" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-slate-50" ref={listRef}>
          {messages.map(m => {
            const d = new Date(m.created)
            return (
              <div
                key={m.id}
                className={`flex ${m.sender === 'student' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`px-4 py-2 rounded-2xl max-w-[70%] ${
                    m.sender === 'student'
                      ? 'bg-emerald-600 text-white rounded-br-md'
                      : 'bg-white text-slate-800 rounded-bl-md shadow-sm'
                  }`}
                >
                  <div>{m.content}</div>
                  <div className="text-[10px] mt-1 opacity-70 text-right">
                    {formatIndonesiaTime(d)}
                  </div>
                </div>
              </div>
            )
          })}
          {messages.length === 0 && (
            <div className="text-center text-slate-400 text-sm mt-10">Belum ada pesan</div>
          )}
        </div>

        {/* Input */}
        <div className="p-4 bg-white shadow-sm">
          <div className="flex items-center gap-2 bg-slate-100 rounded-full px-3 py-2">
            <button className="p-2">
              <Smile className="h-5 w-5 text-slate-600" />
            </button>
            <button className="p-2">
              <Paperclip className="h-5 w-5 text-slate-600" />
            </button>
            <textarea
              className="flex-1 bg-transparent resize-none px-2 text-sm focus:outline-none"
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
              className={`p-2 rounded-full ${
                input.trim()
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-300 text-white cursor-not-allowed'
              }`}
              title={input.trim() ? 'Kirim' : 'Tulis pesan terlebih dahulu'}
            >
              <Send className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
