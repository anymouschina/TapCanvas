/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  API,
  getLogo,
  showError,
  showInfo,
  showSuccess,
  updateAPI,
  getSystemName,
  getOAuthProviderIcon,
  setUserData,
  onDiscordOAuthClicked,
  onCustomOAuthClicked,
} from '../../helpers';
import Turnstile from 'react-turnstile';
import {
  Button,
  Card,
  Checkbox,
  Divider,
  Form,
  Icon,
  Modal,
} from '@douyinfe/semi-ui';
import Title from '@douyinfe/semi-ui/lib/es/typography/title';
import Text from '@douyinfe/semi-ui/lib/es/typography/text';
import {
  IconGithubLogo,
  IconUser,
  IconKey,
  IconLock,
} from '@douyinfe/semi-icons';
import {
  onGitHubOAuthClicked,
  onLinuxDOOAuthClicked,
  onOIDCClicked,
} from '../../helpers';
import OIDCIcon from '../common/logo/OIDCIcon';
import LinuxDoIcon from '../common/logo/LinuxDoIcon';
import WeChatIcon from '../common/logo/WeChatIcon';
import TelegramLoginButton from 'react-telegram-login/src';
import { UserContext } from '../../context/User';
import { StatusContext } from '../../context/Status';
import { useTranslation } from 'react-i18next';
import { SiDiscord } from 'react-icons/si';

const CONTACT_QR_URL =
  'https://neo-spark.oss-cn-guangzhou.aliyuncs.com/image/20260424/fa9df2e45f28425d9194373cb8bc5b37.png';

const RegisterForm = () => {
  let navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const githubButtonTextKeyByState = {
    idle: '使用 GitHub 继续',
    redirecting: '正在跳转 GitHub...',
    timeout: '请求超时，请刷新页面后重新发起 GitHub 登录',
  };
  const [inputs, setInputs] = useState({
    username: '',
    password: '',
    password2: '',
    email: '',
    verification_code: '',
    wechat_verification_code: '',
    captcha_code: '',
  });
  const [userState, userDispatch] = useContext(UserContext);
  const [statusState] = useContext(StatusContext);
  const [turnstileEnabled, setTurnstileEnabled] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [showWeChatLoginModal, setShowWeChatLoginModal] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [wechatLoading, setWechatLoading] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);
  const [discordLoading, setDiscordLoading] = useState(false);
  const [oidcLoading, setOidcLoading] = useState(false);
  const [linuxdoLoading, setLinuxdoLoading] = useState(false);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [verificationCodeLoading, setVerificationCodeLoading] = useState(false);
  const [wechatCodeSubmitLoading, setWechatCodeSubmitLoading] = useState(false);
  const [captcha, setCaptcha] = useState({ token: '', image: '' });
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [customOAuthLoading, setCustomOAuthLoading] = useState({});
  const [disableButton, setDisableButton] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [hasUserAgreement, setHasUserAgreement] = useState(false);
  const [hasPrivacyPolicy, setHasPrivacyPolicy] = useState(false);
  const [githubButtonState, setGithubButtonState] = useState('idle');
  const [githubButtonDisabled, setGithubButtonDisabled] = useState(false);
  const githubTimeoutRef = useRef(null);
  const githubButtonText = t(githubButtonTextKeyByState[githubButtonState]);
  const requestedNext = searchParams.get('next');
  const nextPath =
    requestedNext?.startsWith('/') && !requestedNext.startsWith('//')
      ? requestedNext
      : '/console';
  const loginPath = `/login?next=${encodeURIComponent(nextPath)}`;

  const logo = getLogo();
  const systemName = getSystemName();

  let affCode = new URLSearchParams(window.location.search).get('aff');
  if (affCode) {
    localStorage.setItem('aff', affCode);
  }

  const status = useMemo(() => {
    if (statusState?.status) return statusState.status;
    const savedStatus = localStorage.getItem('status');
    if (!savedStatus) return {};
    try {
      return JSON.parse(savedStatus) || {};
    } catch (err) {
      return {};
    }
  }, [statusState?.status]);
  const hasCustomOAuthProviders =
    (status.custom_oauth_providers || []).length > 0;
  const hasOAuthRegisterOptions = Boolean(
    status.github_oauth ||
      status.discord_oauth ||
      status.oidc_enabled ||
      status.wechat_login ||
      status.linuxdo_oauth ||
      status.telegram_oauth ||
      hasCustomOAuthProviders,
  );

  useEffect(() => {
    if (status?.turnstile_check) {
      setTurnstileEnabled(true);
      setTurnstileSiteKey(status.turnstile_site_key);
    }

    // 从 status 获取用户协议和隐私政策的启用状态
    setHasUserAgreement(status?.user_agreement_enabled || false);
    setHasPrivacyPolicy(status?.privacy_policy_enabled || false);
  }, [status]);

  const refreshCaptcha = async () => {
    setCaptchaLoading(true);
    try {
      const res = await API.get('/api/captcha');
      const data = res.data?.data;
      if (res.data?.success && data?.token && data?.image) {
        setCaptcha({ token: data.token, image: data.image });
        setInputs((current) => ({ ...current, captcha_code: '' }));
      } else {
        showError('图形验证码加载失败，请刷新重试');
      }
    } catch {
      showError('图形验证码加载失败，请刷新重试');
    } finally {
      setCaptchaLoading(false);
    }
  };

  useEffect(() => {
    void refreshCaptcha();
  }, []);

  useEffect(() => {
    let countdownInterval = null;
    if (disableButton && countdown > 0) {
      countdownInterval = setInterval(() => {
        setCountdown((c) => c - 1);
      }, 1000);
    } else if (countdown === 0) {
      setDisableButton(false);
      setCountdown(60);
    }
    return () => clearInterval(countdownInterval);
  }, [disableButton, countdown]);

  useEffect(() => {
    return () => {
      if (githubTimeoutRef.current) {
        clearTimeout(githubTimeoutRef.current);
      }
    };
  }, []);

  const onWeChatLoginClicked = () => {
    setWechatLoading(true);
    setShowWeChatLoginModal(true);
    setWechatLoading(false);
  };

  const onSubmitWeChatVerificationCode = async () => {
    if (turnstileEnabled && turnstileToken === '') {
      showInfo('请稍后几秒重试，Turnstile 正在检查用户环境！');
      return;
    }
    setWechatCodeSubmitLoading(true);
    try {
      const res = await API.get(
        `/api/oauth/wechat?code=${inputs.wechat_verification_code}`,
      );
      const { success, message, data } = res.data;
      if (success) {
        userDispatch({ type: 'login', payload: data });
        localStorage.setItem('user', JSON.stringify(data));
        setUserData(data);
        updateAPI();
        navigate('/');
        showSuccess('登录成功！');
        setShowWeChatLoginModal(false);
      } else {
        showError(message);
      }
    } catch (error) {
      showError('登录失败，请重试');
    } finally {
      setWechatCodeSubmitLoading(false);
    }
  };

  function handleChange(name, value) {
    setInputs((inputs) => ({ ...inputs, [name]: value }));
  }

  const sendEmailVerification = async () => {
    const email = inputs.email.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      showInfo(t('请输入正确的邮箱地址'));
      return;
    }
    if (turnstileEnabled && !turnstileToken) {
      showInfo(t('请稍后几秒重试，Turnstile 正在检查用户环境！'));
      return;
    }
    setVerificationCodeLoading(true);
    try {
      const res = await API.get(
        `/api/verification?email=${encodeURIComponent(email)}&turnstile=${turnstileToken}`,
      );
      const { success, message } = res.data;
      if (success) {
        showSuccess(t('验证码已发送，请查收邮件'));
        setDisableButton(true);
      } else {
        showError(message);
      }
    } catch {
      showError(t('发送验证码失败，请重试'));
    } finally {
      setVerificationCodeLoading(false);
    }
  };

  const handlePasswordRegister = async () => {
    const username = inputs.username.trim();
    const password = inputs.password;
    const password2 = inputs.password2;
    const email = inputs.email.trim();
    const verificationCode = inputs.verification_code.trim();

    if (!username || username.length > 20) {
      showInfo(t('用户名不能为空且不能超过 20 个字符'));
      return;
    }
    if (password.length < 8 || password.length > 20) {
      showInfo(t('密码长度需为 8 到 20 位'));
      return;
    }
    if (password !== password2) {
      showInfo(t('两次输入的密码不一致'));
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      showInfo(t('请输入正确的邮箱地址'));
      return;
    }
    if (status.email_verification && (!email || !verificationCode)) {
      showInfo(t('请输入邮箱和邮箱验证码'));
      return;
    }
    if (turnstileEnabled && !turnstileToken) {
      showInfo(t('请稍后几秒重试，Turnstile 正在检查用户环境！'));
      return;
    }
    if (!captcha.token || !inputs.captcha_code.trim()) {
      showInfo('请输入图形验证码');
      return;
    }

    setRegisterLoading(true);
    try {
      const res = await API.post(
        `/api/user/register?turnstile=${turnstileToken}`,
        {
          username,
          password,
          email,
          verification_code: verificationCode,
          captcha_token: captcha.token,
          captcha_code: inputs.captcha_code.trim(),
          aff_code: localStorage.getItem('aff') || '',
        },
      );
      const { success, message } = res.data;
      if (success) {
        showSuccess(t('注册成功，请登录'));
        navigate(loginPath);
      } else {
        showError(message);
      }
    } catch {
      showError(t('注册失败，请重试'));
    } finally {
      setRegisterLoading(false);
    }
  };

  const handleGitHubClick = () => {
    if (githubButtonDisabled) {
      return;
    }
    setGithubLoading(true);
    setGithubButtonDisabled(true);
    setGithubButtonState('redirecting');
    if (githubTimeoutRef.current) {
      clearTimeout(githubTimeoutRef.current);
    }
    githubTimeoutRef.current = setTimeout(() => {
      setGithubLoading(false);
      setGithubButtonState('timeout');
      setGithubButtonDisabled(true);
    }, 20000);
    try {
      onGitHubOAuthClicked(status.github_client_id, { shouldLogout: true });
    } finally {
      setTimeout(() => setGithubLoading(false), 3000);
    }
  };

  const handleDiscordClick = () => {
    setDiscordLoading(true);
    try {
      onDiscordOAuthClicked(status.discord_client_id, { shouldLogout: true });
    } finally {
      setTimeout(() => setDiscordLoading(false), 3000);
    }
  };

  const handleOIDCClick = () => {
    setOidcLoading(true);
    try {
      onOIDCClicked(
        status.oidc_authorization_endpoint,
        status.oidc_client_id,
        false,
        { shouldLogout: true },
      );
    } finally {
      setTimeout(() => setOidcLoading(false), 3000);
    }
  };

  const handleLinuxDOClick = () => {
    setLinuxdoLoading(true);
    try {
      onLinuxDOOAuthClicked(status.linuxdo_client_id, { shouldLogout: true });
    } finally {
      setTimeout(() => setLinuxdoLoading(false), 3000);
    }
  };

  const handleCustomOAuthClick = (provider) => {
    setCustomOAuthLoading((prev) => ({ ...prev, [provider.slug]: true }));
    try {
      onCustomOAuthClicked(provider, { shouldLogout: true });
    } finally {
      setTimeout(() => {
        setCustomOAuthLoading((prev) => ({ ...prev, [provider.slug]: false }));
      }, 3000);
    }
  };

  const onTelegramLoginClicked = async (response) => {
    const fields = [
      'id',
      'first_name',
      'last_name',
      'username',
      'photo_url',
      'auth_date',
      'hash',
      'lang',
    ];
    const params = {};
    fields.forEach((field) => {
      if (response[field]) {
        params[field] = response[field];
      }
    });
    try {
      const res = await API.get(`/api/oauth/telegram/login`, { params });
      const { success, message, data } = res.data;
      if (success) {
        userDispatch({ type: 'login', payload: data });
        localStorage.setItem('user', JSON.stringify(data));
        showSuccess('登录成功！');
        setUserData(data);
        updateAPI();
        navigate('/');
      } else {
        showError(message);
      }
    } catch (error) {
      showError('登录失败，请重试');
    }
  };

  const renderEmailRegisterForm = () => {
    return (
      <div className='flex flex-col items-center'>
        <div className='w-full max-w-md'>
          <div className='auth-brand flex items-center justify-center mb-6 gap-2'>
            <img src={logo} alt='Logo' className='h-10 rounded-full' />
            <Title heading={3} className='!text-gray-800'>
              {systemName}
            </Title>
          </div>

          <Card className='auth-panel overflow-hidden'>
            <div className='flex justify-center pt-6 pb-2'>
              <Title heading={3} className='text-gray-800 dark:text-gray-200'>
                {t('注 册')}
              </Title>
            </div>
            <div className='px-2 py-8'>
              <Form className='space-y-3'>
                <Form.Input
                  field='username'
                  label={t('用户名')}
                  placeholder={t('请输入用户名')}
                  name='username'
                  onChange={(value) => handleChange('username', value)}
                  prefix={<IconUser />}
                />
                <Form.Input
                  field='email'
                  label={t('邮箱')}
                  placeholder={t('请输入邮箱')}
                  name='email'
                  type='email'
                  onChange={(value) => handleChange('email', value)}
                  prefix={<IconUser />}
                />
                {status.email_verification && (
                  <Form.Input
                    field='verification_code'
                    label={t('邮箱验证码')}
                    placeholder={t('请输入邮箱验证码')}
                    name='verification_code'
                    onChange={(value) => handleChange('verification_code', value)}
                    prefix={<IconKey />}
                    suffix={
                      <Button
                        onClick={sendEmailVerification}
                        loading={verificationCodeLoading}
                        disabled={disableButton || verificationCodeLoading}
                      >
                        {disableButton
                          ? `${t('重新发送')} (${countdown}s)`
                          : t('获取验证码')}
                      </Button>
                    }
                  />
                )}

                <Form.Input
                  field='password'
                  label={t('密码')}
                  placeholder={t('输入密码，最短 8 位')}
                  name='password'
                  mode='password'
                  onChange={(value) => handleChange('password', value)}
                  prefix={<IconLock />}
                />
                <Form.Input
                  field='password2'
                  label={t('确认密码')}
                  placeholder={t('再次输入密码')}
                  name='password2'
                  mode='password'
                  onChange={(value) => handleChange('password2', value)}
                  prefix={<IconLock />}
                />
                <div className='flex items-center gap-3'>
                  <Form.Input
                    field='captcha_code'
                    label={t('图形验证码')}
                    placeholder={t('请输入图形验证码')}
                    name='captcha_code'
                    onChange={(value) => handleChange('captcha_code', value)}
                    prefix={<IconKey />}
                    className='flex-1'
                  />
                  <button
                    type='button'
                    onClick={refreshCaptcha}
                    disabled={captchaLoading}
                    className='mt-7 h-10 w-[132px] overflow-hidden rounded border border-gray-200 bg-white p-0'
                    title={t('点击刷新图形验证码')}
                  >
                    {captcha.image ? (
                      <img src={captcha.image} alt={t('图形验证码')} className='h-full w-full object-cover' />
                    ) : (
                      <span className='text-xs text-gray-500'>{t('刷新验证码')}</span>
                    )}
                  </button>
                </div>

                {(hasUserAgreement || hasPrivacyPolicy) && (
                  <div className='pt-4'>
                    <Checkbox
                      checked={agreedToTerms}
                      onChange={(e) => setAgreedToTerms(e.target.checked)}
                    >
                      <Text size='small' className='text-gray-600'>
                        {t('我已阅读并同意')}
                        {hasUserAgreement && (
                          <>
                            <a
                              href='/user-agreement'
                              target='_blank'
                              rel='noopener noreferrer'
                              className='text-blue-600 hover:text-blue-800 mx-1'
                            >
                              {t('用户协议')}
                            </a>
                          </>
                        )}
                        {hasUserAgreement && hasPrivacyPolicy && t('和')}
                        {hasPrivacyPolicy && (
                          <>
                            <a
                              href='/privacy-policy'
                              target='_blank'
                              rel='noopener noreferrer'
                              className='text-blue-600 hover:text-blue-800 mx-1'
                            >
                              {t('隐私政策')}
                            </a>
                          </>
                        )}
                      </Text>
                    </Checkbox>
                  </div>
                )}

                <div className='space-y-2 pt-2'>
                  <Button
                    theme='solid'
                    className='auth-submit-action w-full'
                    type='primary'
                    htmlType='submit'
                    onClick={handlePasswordRegister}
                    loading={registerLoading}
                    disabled={
                      (hasUserAgreement || hasPrivacyPolicy) && !agreedToTerms
                    }
                  >
                    {t('注 册')}
                  </Button>
                </div>
              </Form>

              {hasOAuthRegisterOptions && (
                <>
                  <Divider margin='12px' align='center'>
                    {t('或')}
                  </Divider>

                  <div className='space-y-3'>
                    {status.wechat_login && (
                      <Button
                        theme='outline'
                        className='w-full h-12 flex items-center justify-center !rounded-full border border-gray-200 hover:bg-gray-50 transition-colors'
                        type='tertiary'
                        icon={
                          <Icon
                            svg={<WeChatIcon />}
                            style={{ color: '#07C160' }}
                          />
                        }
                        onClick={onWeChatLoginClicked}
                        loading={wechatLoading}
                      >
                        <span className='ml-3'>{t('使用 微信 继续')}</span>
                      </Button>
                    )}

                    {status.github_oauth && (
                      <Button
                        theme='outline'
                        className='w-full h-12 flex items-center justify-center !rounded-full border border-gray-200 hover:bg-gray-50 transition-colors'
                        type='tertiary'
                        icon={<IconGithubLogo size='large' />}
                        onClick={handleGitHubClick}
                        loading={githubLoading}
                        disabled={githubButtonDisabled}
                      >
                        <span className='ml-3'>{githubButtonText}</span>
                      </Button>
                    )}

                    {status.discord_oauth && (
                      <Button
                        theme='outline'
                        className='w-full h-12 flex items-center justify-center !rounded-full border border-gray-200 hover:bg-gray-50 transition-colors'
                        type='tertiary'
                        icon={
                          <SiDiscord
                            style={{
                              color: '#5865F2',
                              width: '20px',
                              height: '20px',
                            }}
                          />
                        }
                        onClick={handleDiscordClick}
                        loading={discordLoading}
                      >
                        <span className='ml-3'>{t('使用 Discord 继续')}</span>
                      </Button>
                    )}

                    {status.oidc_enabled && (
                      <Button
                        theme='outline'
                        className='w-full h-12 flex items-center justify-center !rounded-full border border-gray-200 hover:bg-gray-50 transition-colors'
                        type='tertiary'
                        icon={<OIDCIcon style={{ color: '#1877F2' }} />}
                        onClick={handleOIDCClick}
                        loading={oidcLoading}
                      >
                        <span className='ml-3'>{t('使用 OIDC 继续')}</span>
                      </Button>
                    )}

                    {status.linuxdo_oauth && (
                      <Button
                        theme='outline'
                        className='w-full h-12 flex items-center justify-center !rounded-full border border-gray-200 hover:bg-gray-50 transition-colors'
                        type='tertiary'
                        icon={
                          <LinuxDoIcon
                            style={{
                              color: '#E95420',
                              width: '20px',
                              height: '20px',
                            }}
                          />
                        }
                        onClick={handleLinuxDOClick}
                        loading={linuxdoLoading}
                      >
                        <span className='ml-3'>{t('使用 LinuxDO 继续')}</span>
                      </Button>
                    )}

                    {status.custom_oauth_providers &&
                      status.custom_oauth_providers.map((provider) => (
                        <Button
                          key={provider.slug}
                          theme='outline'
                          className='w-full h-12 flex items-center justify-center !rounded-full border border-gray-200 hover:bg-gray-50 transition-colors'
                          type='tertiary'
                          icon={getOAuthProviderIcon(provider.icon || '', 20)}
                          onClick={() => handleCustomOAuthClick(provider)}
                          loading={customOAuthLoading[provider.slug]}
                        >
                          <span className='ml-3'>
                            {t('使用 {{name}} 继续', { name: provider.name })}
                          </span>
                        </Button>
                      ))}

                    {status.telegram_oauth && (
                      <div className='flex justify-center my-2'>
                        <TelegramLoginButton
                          dataOnauth={onTelegramLoginClicked}
                          botName={status.telegram_bot_name}
                        />
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className='mt-6 text-center text-sm'>
                <Text>
                  {t('已有账户？')}{' '}
                  <Link
                    to={loginPath}
                    className='text-blue-600 hover:text-blue-800 font-medium'
                  >
                    {t('登录')}
                  </Link>
                </Text>
              </div>
              <div className='mt-3 text-center'>
                <Button
                  theme='tertiary'
                  type='tertiary'
                  onClick={() => setShowContactModal(true)}
                >
                  联系客服
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    );
  };

  const renderWeChatLoginModal = () => {
    return (
      <Modal
        title={t('微信扫码登录')}
        visible={showWeChatLoginModal}
        maskClosable={true}
        onOk={onSubmitWeChatVerificationCode}
        onCancel={() => setShowWeChatLoginModal(false)}
        okText={t('登录')}
        centered={true}
        okButtonProps={{
          loading: wechatCodeSubmitLoading,
        }}
      >
        <div className='flex flex-col items-center'>
          <img src={status.wechat_qrcode} alt='微信二维码' className='mb-4' />
        </div>

        <div className='text-center mb-4'>
          <p>
            {t('微信扫码关注公众号，输入「验证码」获取验证码（三分钟内有效）')}
          </p>
        </div>

        <Form>
          <Form.Input
            field='wechat_verification_code'
            placeholder={t('验证码')}
            label={t('验证码')}
            value={inputs.wechat_verification_code}
            onChange={(value) =>
              handleChange('wechat_verification_code', value)
            }
          />
        </Form>
      </Modal>
    );
  };

  const renderContactModal = () => (
    <Modal
      title='联系客服'
      visible={showContactModal}
      onCancel={() => setShowContactModal(false)}
      footer={null}
      centered
    >
      <div className='flex flex-col items-center gap-3 py-2'>
        <img src={CONTACT_QR_URL} alt='客服微信二维码' className='h-64 w-64 object-contain' />
        <Text type='tertiary'>扫码添加客服微信，注册或使用遇到问题可直接咨询</Text>
      </div>
    </Modal>
  );

  return (
    <div className='auth-page-shell relative overflow-hidden flex justify-center'>
      <div className='auth-page-shell__content w-full max-w-sm'>
        {renderEmailRegisterForm()}
        {renderWeChatLoginModal()}
        {renderContactModal()}

        {turnstileEnabled && (
          <div className='flex justify-center mt-6'>
            <Turnstile
              sitekey={turnstileSiteKey}
              onVerify={(token) => {
                setTurnstileToken(token);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default RegisterForm;
