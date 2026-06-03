import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from '@bokito/messenger-ui'
import { useAuth } from '../context/AuthContext'

export function LoginPage() {
  const { setToken, apiConfig } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('admin@bokito.ai')
  const [password, setPassword] = useState('bokito-test-password')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await login(apiConfig, email, password)
      setToken(res.access_token)
      navigate('/')
    } catch {
      setError('Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="messenger-login">
      <form onSubmit={(e) => void handleSubmit(e)}>
        <h1>Bokito Messenger</h1>
        <p>Sign in to chat with your tenant assistant.</p>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
