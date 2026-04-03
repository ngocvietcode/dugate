import { submitRequest, pollOperation, createDummyPdfBlob } from './utils';

describe('Transform API Endpoint', () => {

  const standardModes = ['convert', 'rewrite', 'redact', 'template'];

  for (const mode of standardModes) {
    it(`should transform document using mode = ${mode}`, async () => {
      const formData = new FormData();
      formData.append('action', mode);
      formData.append('file', createDummyPdfBlob(), 'document.pdf');
      
      const res = await submitRequest('/transform', formData);
      expect(res.status).toBe(202);
      
      const resData = await res.json();
      const operationId = resData.name.split('/')[1];
      const finalState = await pollOperation(operationId);
      
      expect(finalState.done).toBe(true);
      expect(finalState.metadata.state).toBe('SUCCEEDED');
    });
  }

  it('should pass targetLanguage parameter for translate mode', async () => {
    const formData = new FormData();
    formData.append('action', 'translate');
    formData.append('targetLanguage', 'Vietnamese');
    formData.append('file', createDummyPdfBlob(), 'document.pdf');
    
    const res = await submitRequest('/transform', formData);
    expect(res.status).toBe(202);
    
    const resData = await res.json();
    const operationId = resData.name.split('/')[1];
    const finalState = await pollOperation(operationId);
    expect(finalState.done).toBe(true);
    expect(finalState.metadata.state).toBe('SUCCEEDED');
  });

});
