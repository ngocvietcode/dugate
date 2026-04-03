import { submitRequest, pollOperation, createDummyPdfBlob, createDummyDocxBlob } from './utils';

describe('Ingest API Endpoint', () => {
  
  it('should reject invalid mode', async () => {
    const formData = new FormData();
    formData.append('mode', 'invalid_mode');
    formData.append('file', createDummyPdfBlob(), 'test.pdf');
    
    const res = await submitRequest('/ingest', formData);
    expect(res.status).toBe(400); // Bad Request expected
    
    const data = await res.json();
    expect(data.detail).toBeDefined();
    expect(data.detail).toMatch(/validation|must be one of/i);
  });

  const validModes = ['parse', 'ocr', 'digitize', 'split'];

  for (const mode of validModes) {
    it(`should successfully process a PDF with mode = ${mode}`, async () => {
      const formData = new FormData();
      formData.append('mode', mode);
      formData.append('file', createDummyPdfBlob(), 'test.pdf');
      
      const res = await submitRequest('/ingest', formData);
      if (res.status !== 202) {
        console.error('Failed request error:', await res.text());
      }
      expect(res.status).toBe(202); // Accepted
      
      const resData = await res.json();
      const operationId = resData.name.split('/')[1];
      console.log('DEBUG resData:', resData, 'Extracted ID:', operationId);
      expect(operationId).toBeDefined();
      
      const finalState = await pollOperation(operationId);
      expect(finalState.done).toBe(true);
      expect(finalState.metadata.state).toBe('SUCCEEDED');
      expect(finalState.result.output_format).toBe('json');
    });
  }

  it('should accept multiple files', async () => {
    const formData = new FormData();
    formData.append('mode', 'parse');
    formData.append('files[]', createDummyPdfBlob(), 'file1.pdf');
    formData.append('files[]', createDummyDocxBlob(), 'file2.docx');
    
    const res = await submitRequest('/ingest', formData);
    expect(res.status).toBe(202);
    
    const resData = await res.json();
    const operationId = resData.name.split('/')[1];
    const finalState = await pollOperation(operationId);
    expect(finalState.done).toBe(true);
    expect(finalState.metadata.state).toBe('SUCCEEDED');
    
    // We expect the stepsResultJson to have items mapping to our files
    const results = finalState.result.pipeline_steps;
    expect(results.length).toBeGreaterThan(0);
  });
});
