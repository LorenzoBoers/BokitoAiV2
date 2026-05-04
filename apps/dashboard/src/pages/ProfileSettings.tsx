import React, { useState } from 'react';
import { User, Mail, Shield, Key, Copy, CheckCircle, QrCode, Smartphone } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';

export default function ProfileSettings() {
  const { user } = useAuth();
  
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  // 2FA state
  const [twoFAEnabled, setTwoFAEnabled] = useState(false);
  const [showQRCode, setShowQRCode] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [recoveryCodes] = useState([
    'ABCD-1234', 'EFGH-5678', 'IJKL-9012', 'MNOP-3456', 'QRST-7890',
    'UVWX-1234', 'YZAB-5678', 'CDEF-9012', 'GHIJ-3456', 'KLMN-7890'
  ]);
  const [recoveryCodesVisible, setRecoveryCodesVisible] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);

  const handleSaveProfile = () => {
    // In a real app, this would save to the backend
    console.log('Saving profile:', { name, email });
    alert('Profiel opgeslagen!');
  };

  const handleChangePassword = () => {
    if (newPassword !== confirmPassword) {
      alert('Wachtwoorden komen niet overeen');
      return;
    }
    
    // In a real app, this would change the password
    console.log('Changing password');
    alert('Wachtwoord gewijzigd!');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleEnable2FA = () => {
    setShowQRCode(true);
  };

  const handleVerify2FA = () => {
    if (verificationCode.length === 6) {
      setTwoFAEnabled(true);
      setShowQRCode(false);
      setRecoveryCodesVisible(true);
      setVerificationCode('');
      alert('2FA succesvol ingeschakeld!');
    } else {
      alert('Voer een geldige 6-cijferige code in');
    }
  };

  const handleDisable2FA = () => {
    if (confirm('Weet je zeker dat je 2FA wilt uitschakelen?')) {
      setTwoFAEnabled(false);
      setRecoveryCodesVisible(false);
      alert('2FA uitgeschakeld');
    }
  };

  const handleCopyRecoveryCodes = () => {
    const codesText = recoveryCodes.join('\n');
    navigator.clipboard.writeText(codesText);
    setCopiedCodes(true);
    setTimeout(() => setCopiedCodes(false), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-heading mb-2">
          Profiel instellingen
        </h1>
        <p className="text-text-muted">
          Beheer je persoonlijke gegevens en beveiligingsinstellingen
        </p>
      </div>

      {/* Profile Information */}
      <Card className="p-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center">
            <User size={32} className="text-accent" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-heading">
              {user?.name}
            </h2>
            <p className="text-text-muted">
              {user?.email}
            </p>
            <Badge variant="secondary" className="mt-1">
              {user?.role === 'owner' ? 'Eigenaar' : 
               user?.role === 'admin' ? 'Beheerder' :
               user?.role === 'editor' ? 'Editor' : 'Kijker'}
            </Badge>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Naam
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="max-w-md"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              E-mailadres
            </label>
            <div className="flex items-center gap-2 max-w-md">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Mail size={16} className="text-text-muted" />
            </div>
          </div>
        </div>

        <div className="flex justify-end mt-6 pt-6 border-t border-border">
          <Button onClick={handleSaveProfile}>
            Profiel opslaan
          </Button>
        </div>
      </Card>

      {/* Change Password */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-text-heading mb-4">
          Wachtwoord wijzigen
        </h2>
        
        <div className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Huidig wachtwoord
            </label>
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Nieuw wachtwoord
            </label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Bevestig nieuw wachtwoord
            </label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end mt-6 pt-6 border-t border-border">
          <Button 
            onClick={handleChangePassword}
            disabled={!currentPassword || !newPassword || !confirmPassword}
          >
            Wachtwoord wijzigen
          </Button>
        </div>
      </Card>

      {/* Two-Factor Authentication */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-text-heading mb-2">
              Twee-factor authenticatie (2FA)
            </h2>
            <p className="text-text-muted">
              Voeg een extra beveiligingslaag toe aan je account
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <Badge variant={twoFAEnabled ? 'default' : 'secondary'}>
              {twoFAEnabled ? 'Ingeschakeld' : 'Uitgeschakeld'}
            </Badge>
            
            {twoFAEnabled ? (
              <Button variant="destructive" size="sm" onClick={handleDisable2FA}>
                Uitschakelen
              </Button>
            ) : (
              <Button onClick={handleEnable2FA}>
                <Shield size={16} />
                Inschakelen
              </Button>
            )}
          </div>
        </div>

        {/* QR Code Setup */}
        {showQRCode && (
          <div className="border-t border-border pt-6">
            <h3 className="font-medium text-text-heading mb-4">
              2FA instellen
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-medium text-text-primary mb-3">
                  1. Scan QR-code
                </h4>
                <div className="w-48 h-48 bg-bg-muted rounded-lg flex items-center justify-center mb-4">
                  <div className="text-center">
                    <QrCode size={48} className="mx-auto text-text-muted mb-2" />
                    <p className="text-sm text-text-muted">
                      QR-code (demo)
                    </p>
                  </div>
                </div>
                <p className="text-sm text-text-muted">
                  Gebruik een authenticator app zoals Google Authenticator of Authy
                </p>
              </div>
              
              <div>
                <h4 className="font-medium text-text-primary mb-3">
                  2. Voer verificatiecode in
                </h4>
                <div className="space-y-4">
                  <Input
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value)}
                    placeholder="123456"
                    maxLength={6}
                    className="text-center text-lg tracking-widest"
                  />
                  
                  <Button 
                    onClick={handleVerify2FA}
                    disabled={verificationCode.length !== 6}
                    className="w-full"
                  >
                    <CheckCircle size={16} />
                    2FA verifiëren
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Recovery Codes */}
        {recoveryCodesVisible && (
          <div className="border-t border-border pt-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-text-heading">
                Herstelcodes
              </h3>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCopyRecoveryCodes}
              >
                {copiedCodes ? <CheckCircle size={16} /> : <Copy size={16} />}
                {copiedCodes ? 'Gekopieerd!' : 'Kopiëren'}
              </Button>
            </div>
            
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
              <div className="flex items-start gap-3">
                <Key size={20} className="text-yellow-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-medium text-yellow-800 mb-1">
                    Belangrijk: Bewaar deze codes veilig
                  </h4>
                  <p className="text-sm text-yellow-700">
                    Deze codes kunnen worden gebruikt om in te loggen als je je authenticator app kwijt bent. 
                    Elke code kan maar één keer worden gebruikt.
                  </p>
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-2 font-mono text-sm">
              {recoveryCodes.map((code, index) => (
                <div
                  key={index}
                  className="p-2 bg-bg-muted rounded border text-center"
                >
                  {code}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 2FA Status */}
        {twoFAEnabled && !recoveryCodesVisible && (
          <div className="border-t border-border pt-6">
            <div className="flex items-center gap-3 text-green-700">
              <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle size={16} />
              </div>
              <div>
                <p className="font-medium">
                  2FA is ingeschakeld
                </p>
                <p className="text-sm text-text-muted">
                  Je account is beveiligd met twee-factor authenticatie
                </p>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}