import { useEffect, useRef, useState } from 'react'
import {
  runAgentTurn,
  transcribeAudio,
  type GeminiContent
} from '../../services/agentService'
import {
  chatOriginLabel,
  deleteMoergelChat,
  fingerprintMessages,
  getActiveConversationId,
  mergeChatMessages,
  saveMoergelChat,
  setActiveConversationId,
  subscribeMoergelChats,
  toGeminiTurns,
  type MoergelConversation,
  type MoergelStoredMessage
} from '../../services/moergelConversationService'
import '../../styles/MoergelChat.css'

interface MoergelChatProps {
  admin: { id?: string; name?: string; username?: string }
}

interface PendingConfirm {
  summary: string
  resolve: (ok: boolean) => void
}

const GREETING =
  'Hallo, ich bin Mörgel 👋 Sag mir z. B.: „Buche den letzten Zeiteintrag von Lukas auf Projekt Musterstraße um." Du kannst auch auf das Mikrofon tippen und es mir sagen. Preise und allgemeine Fragen suche ich im Internet.'

function newId(): string {
  return crypto.randomUUID()
}

function toStored(messages: MoergelStoredMessage[]): MoergelStoredMessage[] {
  return messages.filter((message) => message.role === 'user' || message.role === 'assistant')
}

const MoergelChat: React.FC<MoergelChatProps> = ({ admin }) => {
  const [isOpen, setIsOpen] = useState(false)
  const [showList, setShowList] = useState(false)
  const [conversations, setConversations] = useState<MoergelConversation[]>([])
  const [activeId, setActiveId] = useState(() => getActiveConversationId() || newId())
  const [messages, setMessages] = useState<MoergelStoredMessage[]>([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null)

  const contentsRef = useRef<GeminiContent[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const messagesRef = useRef(messages)
  const activeIdRef = useRef(activeId)
  messagesRef.current = messages
  activeIdRef.current = activeId

  const owner = { username: admin.username, name: admin.name }

  const applyMessages = (next: MoergelStoredMessage[]) => {
    messagesRef.current = next
    setMessages(next)
    contentsRef.current = toGeminiTurns(next)
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, status, pendingConfirm, showList])

  useEffect(() => {
    return subscribeMoergelChats(
      { username: admin.username, name: admin.name },
      setConversations
    )
  }, [admin.username, admin.name])

  useEffect(() => {
    if (isBusy) return
    const remote = conversations.find((conversation) => conversation.id === activeId)
    if (!remote) return
    const local = toStored(messagesRef.current)
    if (fingerprintMessages(local) === fingerprintMessages(remote.messages)) return
    applyMessages(mergeChatMessages(local, remote.messages))
  }, [conversations, activeId, isBusy])

  const confirmMutation = (summary: string): Promise<boolean> =>
    new Promise((resolve) => setPendingConfirm({ summary, resolve }))

  const resolvePending = (ok: boolean) => {
    pendingConfirm?.resolve(ok)
    setPendingConfirm(null)
  }

  const persist = async (next: MoergelStoredMessage[]) => {
    try {
      await saveMoergelChat(owner, activeIdRef.current, next)
    } catch (error) {
      console.error('Mörgel-Chat konnte nicht gespeichert werden:', error)
    }
  }

  const sendText = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isBusy) return
    setInput('')
    setShowList(false)
    const userMessage: MoergelStoredMessage = {
      id: newId(),
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
      sourceApp: 'zeit'
    }
    const withUser = [...messagesRef.current, userMessage]
    applyMessages(withUser)
    contentsRef.current = toGeminiTurns(withUser)
    setIsBusy(true)
    try {
      const { reply, contents } = await runAgentTurn(contentsRef.current, admin, {
        confirmMutation,
        onStatus: setStatus
      })
      contentsRef.current = contents
      const next = [
        ...withUser,
        {
          id: newId(),
          role: 'assistant' as const,
          content: reply,
          timestamp: new Date().toISOString(),
          sourceApp: 'zeit' as const
        }
      ]
      applyMessages(next)
      await persist(next)
    } catch (error: any) {
      const next = [
        ...withUser,
        {
          id: newId(),
          role: 'assistant' as const,
          content: `⚠️ Fehler: ${error?.message || 'Unbekannter Fehler'}`,
          timestamp: new Date().toISOString(),
          sourceApp: 'zeit' as const
        }
      ]
      applyMessages(next)
      await persist(next)
    } finally {
      setStatus(null)
      setIsBusy(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void sendText(input)
  }

  const startNewChat = () => {
    const id = newId()
    setActiveId(id)
    setActiveConversationId(id)
    applyMessages([])
    setShowList(false)
  }

  const openConversation = (conversation: MoergelConversation) => {
    setActiveId(conversation.id)
    setActiveConversationId(conversation.id)
    applyMessages(conversation.messages)
    setShowList(false)
  }

  const removeConversation = async (id: string) => {
    if (!window.confirm('Diesen Chat wirklich löschen?')) return
    await deleteMoergelChat(id)
    if (id === activeIdRef.current) startNewChat()
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      audioChunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType })
        await handleTranscription(blob, recorder.mimeType)
      }
      mediaRecorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
    } catch {
      const next = [
        ...messagesRef.current,
        {
          id: newId(),
          role: 'assistant' as const,
          content: '⚠️ Kein Zugriff aufs Mikrofon. Bitte Berechtigung erlauben.',
          timestamp: new Date().toISOString(),
          sourceApp: 'zeit' as const
        }
      ]
      applyMessages(next)
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setIsRecording(false)
  }

  const handleTranscription = async (blob: Blob, mimeType: string) => {
    setStatus('hört zu …')
    setIsBusy(true)
    try {
      const base64 = await blobToBase64(blob)
      const text = await transcribeAudio(base64, mimeType.split(';')[0] || 'audio/webm')
      setStatus(null)
      setIsBusy(false)
      if (text) {
        setInput(text)
      } else {
        const next = [
          ...messagesRef.current,
          {
            id: newId(),
            role: 'assistant' as const,
            content: 'Ich habe leider nichts verstanden – bitte nochmal.',
            timestamp: new Date().toISOString(),
            sourceApp: 'zeit' as const
          }
        ]
        applyMessages(next)
      }
    } catch (error: any) {
      setStatus(null)
      setIsBusy(false)
      const next = [
        ...messagesRef.current,
        {
          id: newId(),
          role: 'assistant' as const,
          content: `⚠️ Transkription fehlgeschlagen: ${error?.message || ''}`,
          timestamp: new Date().toISOString(),
          sourceApp: 'zeit' as const
        }
      ]
      applyMessages(next)
    }
  }

  const visible = messages.filter((message) => message.role === 'user' || message.role === 'assistant')

  return (
    <>
      <button
        className="moergel-fab"
        onClick={() => setIsOpen((o) => !o)}
        aria-label="Mörgel öffnen"
        title="Mörgel – KI-Assistent"
      >
        {isOpen ? '×' : '💬'}
      </button>

      {isOpen && (
        <div className="moergel-panel" role="dialog" aria-label="Mörgel Chat">
          <div className="moergel-header">
            <div className="moergel-header-title">
              <span className="moergel-avatar">🤖</span>
              <div>
                <strong>Mörgel</strong>
                <small>KI-Assistent</small>
              </div>
            </div>
            <div className="moergel-header-actions">
              <button type="button" className="moergel-header-btn" onClick={() => setShowList((v) => !v)}>
                Chats
              </button>
              <button type="button" className="moergel-header-btn" onClick={startNewChat}>
                Neu
              </button>
              <button className="moergel-close" onClick={() => setIsOpen(false)} aria-label="Schließen">
                ×
              </button>
            </div>
          </div>

          {showList ? (
            <div className="moergel-list">
              {conversations.length === 0 ? (
                <p className="moergel-list-empty">Noch keine gespeicherten Chats.</p>
              ) : (
                conversations.map((conversation) => (
                  <div key={conversation.id} className="moergel-list-row">
                    <button type="button" className="moergel-list-item" onClick={() => openConversation(conversation)}>
                      <strong>{conversation.title}</strong>
                      <small>
                        {conversation.updatedAt.toLocaleDateString('de-DE')}
                        {chatOriginLabel(conversation.sourceApp)
                          ? ` · ${chatOriginLabel(conversation.sourceApp)}`
                          : ''}
                      </small>
                    </button>
                    <button
                      type="button"
                      className="moergel-list-delete"
                      onClick={() => void removeConversation(conversation.id)}
                      aria-label="Chat löschen"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="moergel-messages">
              {visible.length === 0 && <div className="moergel-msg moergel-msg-assistant">{GREETING}</div>}
              {visible.map((message) => (
                <div key={message.id} className={`moergel-msg moergel-msg-${message.role}`}>
                  {message.content}
                  {message.sourceApp === 'rechnung' && <small className="moergel-origin">Rechnungsprogramm</small>}
                </div>
              ))}

              {status && <div className="moergel-status">{status}</div>}

              {pendingConfirm && (
                <div className="moergel-confirm">
                  <div className="moergel-confirm-summary">{pendingConfirm.summary}</div>
                  <div className="moergel-confirm-actions">
                    <button className="moergel-btn-confirm" onClick={() => resolvePending(true)}>
                      Ja, ausführen
                    </button>
                    <button className="moergel-btn-cancel" onClick={() => resolvePending(false)}>
                      Abbrechen
                    </button>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}

          <form className="moergel-input-row" onSubmit={handleSubmit}>
            <button
              type="button"
              className={`moergel-mic ${isRecording ? 'recording' : ''}`}
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isBusy && !isRecording}
              aria-label={isRecording ? 'Aufnahme stoppen' : 'Sprachnachricht aufnehmen'}
              title={isRecording ? 'Aufnahme stoppen' : 'Sprachnachricht'}
            >
              {isRecording ? '⏹' : '🎤'}
            </button>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isRecording ? 'Aufnahme läuft …' : 'Nachricht an Mörgel …'}
              disabled={isBusy}
            />
            <button type="submit" className="moergel-send" disabled={isBusy || !input.trim()}>
              ➤
            </button>
          </form>
        </div>
      )}
    </>
  )
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] || '')
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export default MoergelChat
