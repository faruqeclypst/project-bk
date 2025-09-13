import { useEffect, useMemo, useRef, useState } from 'react'
import PocketBase from 'pocketbase'
import { MoreVertical, Paperclip, Send, Eye, Loader2, Mail, Lock, Download, Archive } from 'lucide-react'

// Import random username generator
// @ts-ignore
import { generate } from 'random-username-generator'

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
  anonymousName?: string
}

const POCKETBASE_URL = import.meta.env.VITE_PB_URL || 'http://localhost:8090'

// daftar warna avatar
const avatarColors = [
  { bg: 'bg-emerald-200', text: 'text-emerald-700' },
  { bg: 'bg-sky-200', text: 'text-sky-700' },
  { bg: 'bg-rose-200', text: 'text-rose-700' },
  { bg: 'bg-amber-200', text: 'text-amber-700' },
  { bg: 'bg-violet-200', text: 'text-violet-700' },
  { bg: 'bg-indigo-200', text: 'text-indigo-700' },
  { bg: 'bg-teal-200', text: 'text-teal-700' },
]

// ambil warna berdasarkan index
function getColorClass(index: number) {
  const color = avatarColors[index % avatarColors.length]
  return `${color.bg} ${color.text}`
}

export default function Teacher() {
  const pb = useMemo(() => new PocketBase(POCKETBASE_URL), [])

  // Persistent anonymous name generator (stored in localStorage by conversationId)
  function getOrCreateAnonName(conversationId: string): string {
    const storageKey = `anonName:${conversationId}`
    try {
      const existing = localStorage.getItem(storageKey)
      if (existing && existing.trim().length > 0) return existing
    } catch {}

    // Generate random username with 2-digit number
    const randomName = generate()
    const randomNumber = Math.floor(Math.random() * 100).toString().padStart(2, '0')
    const formattedName = `${randomName}-${randomNumber}`
    
    try {
      localStorage.setItem(storageKey, formattedName)
    } catch {}
    return formattedName
  }

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [convId, setConvId] = useState('')
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [archivedConversations, setArchivedConversations] = useState<Conversation[]>([])
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem('unreadCounts')
      return saved ? JSON.parse(saved) : {}
    } catch {
      return {}
    }
  })

  // Function to update unread counts and save to localStorage
  const updateUnreadCounts = (newCounts: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => {
    setUnreadCounts(newCounts)
    try {
      const counts = typeof newCounts === 'function' ? newCounts(unreadCounts) : newCounts
      localStorage.setItem('unreadCounts', JSON.stringify(counts))
    } catch {}
  }

  // Function to calculate unread counts for all conversations
  const calculateUnreadCounts = async (conversations: Conversation[], currentConversationId?: string) => {
    const counts: Record<string, number> = {}
    
    for (const conv of conversations) {
      if (conv.id === currentConversationId) {
        counts[conv.id] = 0 // Current conversation is considered read
        continue
      }
      
      try {
        // Get the last message in this conversation
        const lastMessage = await pb.collection('messages').getFirstListItem<Message>(
          `conversationId = "${conv.id}"`,
          { sort: '-created' }
        )
        
        // If the last message is from student, count it as unread
        if (lastMessage.sender === 'student') {
          // Get all unread messages (messages from student after the last teacher message)
          const teacherMessages = await pb.collection('messages').getFullList<Message>({
            filter: `conversationId = "${conv.id}" && sender = "teacher"`,
            sort: '-created',
            limit: 1
          })
          
          if (teacherMessages.length === 0) {
            // No teacher messages, count all student messages
            const studentMessages = await pb.collection('messages').getFullList<Message>({
              filter: `conversationId = "${conv.id}" && sender = "student"`
            })
            counts[conv.id] = studentMessages.length
          } else {
            // Count student messages after the last teacher message
            const lastTeacherMessage = teacherMessages[0]
            const unreadMessages = await pb.collection('messages').getFullList<Message>({
              filter: `conversationId = "${conv.id}" && sender = "student" && created > "${lastTeacherMessage.created}"`
            })
            counts[conv.id] = unreadMessages.length
          }
        } else {
          counts[conv.id] = 0
        }
      } catch (error) {
        // If no messages found, set count to 0
        counts[conv.id] = 0
      }
    }
    
    return counts
  }
  const [searchQuery, setSearchQuery] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active')
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showEditProfile, setShowEditProfile] = useState(false)
  const [profileName, setProfileName] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)

  const listRef = useRef<HTMLDivElement | null>(null)
  const messageUnsubRef = useRef<(() => void) | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const userMenuRef = useRef<HTMLDivElement | null>(null)

  function logout() {
    try {
      if (messageUnsubRef.current) {
        messageUnsubRef.current()
        messageUnsubRef.current = null
      }
      pb.authStore.clear()
      setConversation(null)
      setMessages([])
      setConversations([])
      setUnreadCounts({})
      setConvId('')
    } catch {}
  }

  const me = pb.authStore.model as any
  const teacherDisplayName = (me?.name as string) || (me?.email as string) || 'Guru'

  const [isAuthed, setIsAuthed] = useState<boolean>(pb.authStore.isValid)
  useEffect(() => {
    const unsub = pb.authStore.onChange(() => {
      setIsAuthed(pb.authStore.isValid)
    })
    return () => unsub()
  }, [pb])

  function getDisplayName(c?: Conversation | null): string {
    if (!c) return '—'
    if (c.studentName && c.studentName.trim().length > 0) return c.studentName
    if (c.isAnonymous) {
      // Use the anonymousName from the conversation record if available
      if (c.anonymousName && c.anonymousName.trim().length > 0) {
        return c.anonymousName
      }
      // Fallback to generating a new name if not available
      return getOrCreateAnonName(c.id)
    }
    return 'Anonim'
  }

  function getInitial(name: string): string {
    const trimmed = name.trim()
    if (!trimmed) return 'A'
    return trimmed.charAt(0).toUpperCase()
  }

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

  const lastStudentMsgAt = useMemo(() => {
    if (!conversation) return null
    let latest: number | null = null
    for (const m of messages) {
      if (m.conversationId === conversation.id && m.sender === 'student') {
        const ts = new Date(m.created).getTime()
        if (latest == null || ts > latest) latest = ts
      }
    }
    return latest
  }, [messages, conversation?.id])

  const isOnline = useMemo(() => {
    if (!lastStudentMsgAt) return false
    return nowTs - lastStudentMsgAt < 2 * 60 * 1000
  }, [nowTs, lastStudentMsgAt])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false)
      }
    }

    if (showDropdown || showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showDropdown, showUserMenu])

  async function saveProfile() {
    try {
      if (!pb.authStore.model?.id) return
      const id = pb.authStore.model.id
      const newName = profileName.trim()
      setIsSavingProfile(true)
      await pb.collection('teachers').update(id, { name: newName })
      // refresh auth model
      const meNew = await pb.collection('teachers').getOne(id)
      pb.authStore.save(pb.authStore.token, meNew)
      setShowEditProfile(false)
    } catch (e) {
      // no-op UI error for now
    } finally {
      setIsSavingProfile(false)
    }
  }

  function isValidEmail(value: string): boolean {
    const v = value.trim()
    if (!v) return false
    return /.+@.+\..+/.test(v)
  }

  async function login() {
    if (!isValidEmail(email) || !password.trim()) {
      setAuthError('Masukkan email dan password yang valid')
      return
    }
    try {
      setAuthError(null)
      setIsSubmitting(true)
      await pb.collection('teachers').authWithPassword(email.trim(), password)
    } catch (e: any) {
      setAuthError(e?.message || 'Gagal login')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function loadConversation(id?: string) {
    const targetId = (id ?? convId).trim()
    if (!targetId) return
    const conv = await pb.collection('conversations').getOne<Conversation>(targetId)
    
    // Ensure anonymous conversations have a name stored in the database
    if (conv.isAnonymous && (!conv.anonymousName || conv.anonymousName.trim().length === 0)) {
      const anonymousName = getOrCreateAnonName(conv.id)
      try {
        const updatedConv = await pb.collection('conversations').update<Conversation>(conv.id, {
          anonymousName: anonymousName
        })
        setConversation(updatedConv)
      } catch (error) {
        console.error('Failed to update conversation with anonymous name:', error)
        setConversation(conv)
      }
    } else {
      setConversation(conv)
    }
    
    const list = await pb
      .collection('messages')
      .getFullList<Message>({ filter: `conversationId = "${conv.id}"`, sort: 'created' })
    setMessages(list)

    if (messageUnsubRef.current) {
      messageUnsubRef.current()
      messageUnsubRef.current = null
    }
    const unsub = await pb.collection('messages').subscribe<Message>(
      '*',
      (e: any) => {
        const rec = e.record as Message
        if (rec.conversationId === conv.id) setMessages(prev => [...prev, rec])
      },
      { filter: `conversationId = "${conv.id}"` }
    )
    messageUnsubRef.current = unsub
    
    // Subscribe to conversation updates to get anonymous name changes
    const convUnsub = await pb.collection('conversations').subscribe<Conversation>(
      '*',
      (e: any) => {
        const rec = e.record as Conversation
        if (rec.id === conv.id && e.action === 'update') {
          setConversation(rec)
        }
      },
      { filter: `id = "${conv.id}"` }
    )
    
    // Store conversation unsub for cleanup
    if (messageUnsubRef.current) {
      const oldUnsub = messageUnsubRef.current
      messageUnsubRef.current = () => {
        oldUnsub()
        convUnsub()
      }
    } else {
      messageUnsubRef.current = convUnsub
    }
    
    // Reset notifikasi untuk percakapan yang sedang dibuka
    updateUnreadCounts(prev => ({ ...prev, [conv.id]: 0 }))
  }

  async function sendTeacherMessage() {
    if (!input.trim() || !conversation?.id) return
    await pb.collection('messages').create({
      conversationId: conversation.id,
      sender: 'teacher',
      content: input.trim(),
    })
    setInput('')
  }

  function exportConversation() {
    if (!conversation || messages.length === 0) return
    
    const conversationData = {
      conversation: {
        id: conversation.id,
        studentName: conversation.studentName,
        isAnonymous: conversation.isAnonymous,
        studentCode: conversation.studentCode,
        teacherId: conversation.teacherId,
      },
      messages: messages.map(m => ({
        id: m.id,
        sender: m.sender,
        content: m.content,
        created: m.created,
      })),
      exportedAt: new Date().toISOString(),
    }
    
    const blob = new Blob([JSON.stringify(conversationData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `conversation-${conversation.id}-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setShowDropdown(false)
  }

  async function archiveConversation() {
    if (!conversation?.id) return
    
    try {
      // Add archive field to conversation
      await pb.collection('conversations').update(conversation.id, {
        archived: true,
        archivedAt: new Date().toISOString(),
      })
      
      // Remove from conversations list
      setConversations(prev => prev.filter(c => c.id !== conversation.id))
      setConversation(null)
      setMessages([])
      setConvId('')
      setShowDropdown(false)
    } catch (error) {
      console.error('Failed to archive conversation:', error)
    }
  }

  async function unarchiveConversation(id: string) {
    try {
      await pb.collection('conversations').update(id, {
        archived: false,
        archivedAt: null,
      })
      setArchivedConversations(prev => prev.filter(c => c.id !== id))
    } catch (error) {
      console.error('Failed to unarchive conversation:', error)
    }
  }

  useEffect(() => {
    if (!pb.authStore.isValid) return
    let unsubConvs: undefined | (() => void)
    let unsubMsgs: undefined | (() => void)
    let unsubConvsUpdates: undefined | (() => void)
    ;(async () => {
      const teacherId = pb.authStore.model?.id || ''
      const list = await pb
        .collection('conversations')
        .getList<Conversation>(1, 100, {
          sort: '-created',
          filter: `teacherId = "${teacherId}" && (archived = false || archived = null)`,
        })
      
      // Ensure all anonymous conversations have names stored in the database
      const updatedConversations = await Promise.all(
        list.items.map(async (conv) => {
          if (conv.isAnonymous && (!conv.anonymousName || conv.anonymousName.trim().length === 0)) {
            const anonymousName = getOrCreateAnonName(conv.id)
            try {
              const updatedConv = await pb.collection('conversations').update<Conversation>(conv.id, {
                anonymousName: anonymousName
              })
              return updatedConv
            } catch (error) {
              console.error('Failed to update conversation with anonymous name:', error)
              return conv
            }
          }
          return conv
        })
      )
      
      setConversations(updatedConversations)

      // Calculate initial unread counts
      const initialUnreadCounts = await calculateUnreadCounts(updatedConversations, conversation?.id)
      updateUnreadCounts(initialUnreadCounts)

      const archivedList = await pb
        .collection('conversations')
        .getList<Conversation>(1, 100, {
          sort: '-archivedAt,-updated',
          filter: `teacherId = "${teacherId}" && archived = true`,
        })
      
      // Ensure all archived anonymous conversations have names stored in the database
      const updatedArchivedConversations = await Promise.all(
        archivedList.items.map(async (conv) => {
          if (conv.isAnonymous && (!conv.anonymousName || conv.anonymousName.trim().length === 0)) {
            const anonymousName = getOrCreateAnonName(conv.id)
            try {
              const updatedConv = await pb.collection('conversations').update<Conversation>(conv.id, {
                anonymousName: anonymousName
              })
              return updatedConv
            } catch (error) {
              console.error('Failed to update archived conversation with anonymous name:', error)
              return conv
            }
          }
          return conv
        })
      )
      
      setArchivedConversations(updatedArchivedConversations)

      unsubConvs = await pb.collection('conversations').subscribe<Conversation>(
        '*',
        (e: any) => {
          if (e.action === 'create') {
            const rec = e.record as Conversation
            if (rec.teacherId === teacherId) {
              setConversations(prev => [rec, ...prev])
            }
          }
        },
        { filter: `teacherId = "${teacherId}" && (archived = false || archived = null)` }
      )

      // move items on updates (archived/unarchived)
      unsubConvsUpdates = await pb.collection('conversations').subscribe<Conversation>(
        '*',
        (e: any) => {
          if (e.action !== 'update') return
          const rec: any = e.record
          if (rec.teacherId !== teacherId) return
          const isArchived = !!rec.archived
          if (isArchived) {
            setConversations(prev => prev.filter(c => c.id !== rec.id))
            setArchivedConversations(prev => {
              const exists = prev.some(c => c.id === rec.id)
              return exists ? prev.map(c => (c.id === rec.id ? rec : c)) : [rec, ...prev]
            })
            if (conversation?.id === rec.id) setConversation(rec)
          } else {
            setArchivedConversations(prev => prev.filter(c => c.id !== rec.id))
            setConversations(prev => {
              const exists = prev.some(c => c.id === rec.id)
              return exists ? prev.map(c => (c.id === rec.id ? rec : c)) : [rec, ...prev]
            })
            if (conversation?.id === rec.id) setConversation(rec)
          }
        },
        { filter: `teacherId = "${teacherId}"` }
      )

      unsubMsgs = await pb.collection('messages').subscribe<Message>(
        '*',
        (e: any) => {
          const rec = e.record as Message
          // Hanya hitung pesan dari siswa yang belum dibaca
          if (rec.sender === 'student' && rec.conversationId !== conversation?.id) {
            updateUnreadCounts(prev => ({
              ...prev,
              [rec.conversationId]: (prev[rec.conversationId] || 0) + 1,
            }))
          }
        },
        {}
      )
    })()
    return () => {
      if (unsubConvs) unsubConvs()
      if (unsubMsgs) unsubMsgs()
      if (unsubConvsUpdates) unsubConvsUpdates()
      if (messageUnsubRef.current) {
        messageUnsubRef.current()
        messageUnsubRef.current = null
      }
    }
  }, [pb, isAuthed, conversation?.id])

  // ===== UI START =====
  if (!pb.authStore.isValid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-emerald-50 to-sky-50 p-6">
        {/* Login Form */}
        <div className="w-full max-w-md bg-white rounded-3xl shadow-lg p-6 space-y-6">
          <div className="text-center space-y-1">
            <h1 className="text-xl font-semibold text-slate-800">Masuk Guru</h1>
            <p className="text-sm text-slate-500">Silakan login untuk mengakses percakapan</p>
          </div>

          {authError && (
            <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {authError}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
              <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-emerald-400">
                <Mail className="h-4 w-4 text-slate-500" />
                <input
                  type="email"
                  autoComplete="username"
                  className="flex-1 bg-transparent text-sm outline-none"
                  placeholder="guru@email.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') login()
                  }}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Password</label>
              <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-emerald-400">
                <Lock className="h-4 w-4 text-slate-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  className="flex-1 bg-transparent text-sm outline-none"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') login()
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="p-1 rounded hover:bg-slate-200"
                  title={showPassword ? 'Sembunyikan' : 'Tampilkan'}
                >
                  <Eye className="h-4 w-4 text-slate-600" />
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={login}
            disabled={isSubmitting}
            className={`w-full inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition ${
              isSubmitting ? 'bg-emerald-400' : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isSubmitting ? 'Masuk...' : 'Masuk'}
          </button>

          <div className="text-[11px] text-center text-slate-400">
            Terkoneksi ke PocketBase: <span className="font-mono">{POCKETBASE_URL}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex justify-center bg-slate-100">
      <div className="flex w-full max-w-6xl bg-white rounded-xl shadow-lg overflow-hidden">
        {/* Sidebar baru */}
        <aside className="w-[380px] bg-white border-r border-slate-200 flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-slate-200">
            <h3 className="text-lg font-semibold text-slate-800">Bimbingan Konseling</h3>
            <div className="mt-3">
              <input
                className="w-full bg-slate-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-400 border-0"
                placeholder="Cari nama/kode..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm bg-slate-100 p-1 rounded-lg">
              <button
                onClick={() => setActiveTab('active')}
                className={`px-3 py-1 rounded-md transition ${
                  activeTab === 'active' ? 'bg-white text-slate-800 shadow' : 'text-slate-600'
                }`}
              >
                Aktif
              </button>
              <button
                onClick={() => setActiveTab('archived')}
                className={`px-3 py-1 rounded-md transition ${
                  activeTab === 'archived' ? 'bg-white text-slate-800 shadow' : 'text-slate-600'
                }`}
              >
                Arsip
              </button>
            </div>
          </div>

          {/* List percakapan */}
          <div className="flex-1 overflow-y-auto">
            {(activeTab === 'active' ? conversations : archivedConversations).map((c, idx) => {
              const name = getDisplayName(c)
              const initial = getInitial(name)
              const unread = activeTab === 'active' ? (unreadCounts[c.id] || 0) : 0
              return (
                <div key={c.id} className="relative">
                <button
                  onClick={() => {
                    setConvId(c.id)
                    void loadConversation(c.id)
                  }}
                    className={`w-full flex items-center gap-3 px-4 py-3 pr-20 transition text-left border-l-4 ${
                    conversation?.id === c.id
                        ? 'bg-emerald-50 border-emerald-500'
                        : 'border-transparent hover:bg-slate-50'
                  }`}
                >
                  <div
                    className={`h-10 w-10 rounded-full flex items-center justify-center font-semibold ${getColorClass(
                      idx
                    )}`}
                  >
                    {initial}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-slate-800 truncate">{name}</div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      {c.isAnonymous ? (
                        <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-[10px]">
                          Anonim
                        </span>
                      ) : (
                        <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded text-[10px]">
                          Nama
                        </span>
                      )}
                      {c.studentCode && (
                        <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-mono">
                          {c.studentCode}
                        </span>
                      )}
                    </div>
                  </div>
                  {unread > 0 && (
                    <span className="bg-rose-500 text-white text-xs font-bold rounded-full px-2 py-0.5">
                      {unread}
                    </span>
                  )}
                </button>
                  {activeTab === 'archived' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); unarchiveConversation(c.id) }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded"
                    >
                      Unarchive
                    </button>
                  )}
                </div>
              )
            })}
            {(activeTab === 'active' ? conversations.length === 0 : archivedConversations.length === 0) && (
              <div className="p-6 text-center text-slate-400 text-sm">
                {activeTab === 'active' ? 'Belum ada percakapan' : 'Belum ada arsip'}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-slate-200">
            <div className="relative flex items-center gap-3 rounded-full pl-3 pr-3 h-12" ref={userMenuRef}>
              <button
                onClick={() => setShowUserMenu(v => !v)}
                className="h-9 w-9 rounded-full bg-emerald-200 text-emerald-700 flex items-center justify-center font-semibold hover:bg-emerald-300 transition"
                title="Menu pengguna"
              >
                {(teacherDisplayName.charAt(0) || 'G').toUpperCase()}
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-800 truncate">
                  {teacherDisplayName}
                </div>
              </div>
              {showUserMenu && (
                <div className="absolute left-3 bottom-full mb-2 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-50">
                  <div className="py-1">
                    <button
                      onClick={() => {
                        setShowEditProfile(true)
                        setProfileName((pb.authStore.model?.name as string) || '')
                        setShowUserMenu(false)
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      Edit Profil
                    </button>
                    <button
                      onClick={logout}
                      className="w-full text-left px-4 py-2 text-sm text-rose-600 hover:bg-rose-50"
                    >
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Chat area */}
        <main className="flex-1 flex flex-col">
          {/* Edit Profile Modal */}
          {showEditProfile && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="absolute inset-0 bg-black/30" onClick={() => setShowEditProfile(false)} />
              <div className="relative bg-white w-full max-w-sm rounded-xl shadow-lg p-5">
                <h3 className="text-base font-semibold text-slate-800">Edit Profil</h3>
                <p className="text-xs text-slate-500 mt-1">Ubah nama tampilan Anda.</p>
                <div className="mt-4">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nama</label>
                  <input
                    className="w-full bg-slate-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-400 border-0"
                    value={profileName}
                    onChange={e => setProfileName(e.target.value)}
                  />
                </div>
                <div className="mt-5 flex items-center justify-end gap-2">
                  <button
                    onClick={() => setShowEditProfile(false)}
                    className="px-3 py-1.5 text-sm rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800"
                  >
                    Batal
                  </button>
                  <button
                    onClick={saveProfile}
                    disabled={isSavingProfile || !profileName.trim()}
                    className={`px-3 py-1.5 text-sm rounded-lg text-white ${
                      isSavingProfile || !profileName.trim()
                        ? 'bg-emerald-300 cursor-not-allowed'
                        : 'bg-emerald-600 hover:bg-emerald-700'
                    }`}
                  >
                    {isSavingProfile ? 'Menyimpan...' : 'Simpan'}
                  </button>
                </div>
              </div>
            </div>
          )}
          {conversation ? (
            <div className="flex items-center gap-3 p-4 bg-white border-b border-slate-200">
              <div className={`h-9 w-9 rounded-full flex items-center justify-center font-semibold ${getColorClass(0)}`}>
                {getInitial(getDisplayName(conversation))}
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-slate-800 truncate max-w-[200px] block">
                  {getDisplayName(conversation)}
                </span>
                <span className="text-xs text-slate-500 flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                  {isOnline ? 'Online' : 'Offline'}
                </span>
              </div>
              <div className="ml-auto relative" ref={dropdownRef}>
                <button
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="p-1 rounded-lg hover:bg-slate-100 transition"
                >
                <MoreVertical className="h-5 w-5 text-slate-600" />
                </button>
                
                {showDropdown && (
                  <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-50">
                    <div className="py-1">
                      <button
                        onClick={exportConversation}
                        className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition"
                      >
                        <Download className="h-4 w-4" />
                        Export Chat
                      </button>
                      <button
                        onClick={archiveConversation}
                        className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition"
                      >
                        <Archive className="h-4 w-4" />
                        Arsipkan
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
              Pilih percakapan di sidebar
            </div>
          )}

          {conversation && (
            <>
              <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-slate-50">
                {messages.map(m => {
                  const d = new Date(m.created)
                  return (
                    <div key={m.id} className={`flex ${m.sender === 'teacher' ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`px-4 py-2 rounded-2xl max-w-[70%] ${
                          m.sender === 'teacher'
                            ? 'bg-emerald-600 text-white rounded-br-md'
                            : 'bg-white text-slate-800 rounded-bl-md shadow-sm'
                        }`}
                      >
                        <div>{m.content}</div>
                        <div className="text-[10px] mt-1 opacity-70 text-right">{formatIndonesiaTime(d)}</div>
                      </div>
                    </div>
                  )
                })}
                {messages.length === 0 && (
                  <div className="text-center text-slate-400 text-sm mt-10">Belum ada pesan</div>
                )}
              </div>

              {/* Input */}
              <div className="p-4 bg-white border-t border-slate-200">
                <div className="flex items-center gap-2 bg-slate-100 rounded-full pl-3 pr-3 h-12">
                  <button className="flex items-center justify-center h-9 w-9 rounded-full hover:bg-slate-200/60 transition">
                    <Paperclip className="h-5 w-5 text-slate-600" />
                  </button>
                  <textarea
                    className="flex-1 bg-transparent resize-none px-3 text-sm focus:outline-none py-2"
                    rows={1}
                    placeholder="Tulis balasan..."
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        sendTeacherMessage()
                      }
                    }}
                  />
                  <button
                    onClick={sendTeacherMessage}
                    disabled={!input.trim() || !conversation?.id}
                    className={`ml-auto flex items-center justify-center h-9 w-9 rounded-full transition ${
                      input.trim() && conversation?.id
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                        : 'bg-slate-300 text-white cursor-not-allowed'
                    }`}
                  >
                    <Send className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
