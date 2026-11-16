export const maxMessageLength = 2000
export const chatPageSize = 50

export interface ChatContact {
  id: string
  name: string
  role: 'student' | 'teacher'
  classrooms: string[]
}

export interface ChatMessage {
  id: number
  senderId: string
  body: string
  createdAt: string
}

export interface ChatConversation {
  contact: ChatContact
  lastMessage: ChatMessage
  unread: number
}

export interface ChatHistory {
  contact: ChatContact
  messages: ChatMessage[]
  hasOlder: boolean
  unreadIds: number[]
}
