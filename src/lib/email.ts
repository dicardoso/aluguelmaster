export const sendEmail = async (to: string, subject: string, body: string) => {
  try {
    const response = await fetch('/api/email/contract-notification', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, subject, body }),
    });
    
    if (!response.ok) {
      throw new Error('Failed to send email');
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
};

export const sendWelcomeEmail = async (to: string, name: string) => {
  const subject = 'Bem-vindo ao AluguelMaster!';
  const body = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
      <h2 style="color: #2563eb; text-align: center;">Bem-vindo ao AluguelMaster!</h2>
      <p>Olá <strong>${name || 'Usuário'}</strong>,</p>
      <p>Seu cadastro foi realizado com sucesso. Estamos muito felizes em ter você conosco!</p>
      <p>O AluguelMaster é a sua plataforma completa para gestão inteligente de contratos de aluguel residencial e comercial.</p>
      <p>Acesse a plataforma para conferir seus contratos, recibos e muito mais.</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${window.location.origin}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Acessar Plataforma</a>
      </div>
      <p style="color: #666; font-size: 14px; text-align: center;">Se você tiver alguma dúvida, não hesite em nos contatar.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #999; font-size: 12px; text-align: center;">&copy; ${new Date().getFullYear()} AluguelMaster. Todos os direitos reservados.</p>
    </div>
  `;
  
  return sendEmail(to, subject, body);
};
